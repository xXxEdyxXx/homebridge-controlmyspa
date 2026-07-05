"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpaPlatformAccessory = void 0;
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
class SpaPlatformAccessory {
    platform;
    accessory;
    thermostatService;
    lightServices = new Map();
    pumpServices = new Map();
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        // Set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
            .setCharacteristic(this.platform.Characteristic.Model, 'ControlMySpa')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.spaId || 'Default-Serial');
        // --- Thermostat Service ---
        this.thermostatService = this.accessory.getService(this.platform.Service.Thermostat) ||
            this.accessory.addService(this.platform.Service.Thermostat);
        this.thermostatService.setCharacteristic(this.platform.Characteristic.Name, 'Spa Temperature');
        // Register handlers for Thermostat characteristics
        this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.getCurrentTemperature.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .onGet(this.getTargetTemperature.bind(this))
            .onSet(this.setTargetTemperature.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.getCurrentHeatingCoolingState.bind(this));
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .onGet(this.getTargetHeatingCoolingState.bind(this))
            .onSet(this.setTargetHeatingCoolingState.bind(this));
        // Define reasonable temp limits
        this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .setProps({
            minValue: 10,
            maxValue: 40,
            minStep: 0.5,
        });
        // Setup components
        this.setupDynamicComponents();
    }
    /**
     * Parse the dynamic components from the API response
     * and create Switch / Lightbulb services.
     */
    setupDynamicComponents() {
        const spaData = this.accessory.context.spaData;
        const components = spaData?.currentState?.components;
        if (!components)
            return;
        for (const comp of components) {
            const id = comp.port || comp.id;
            const type = comp.componentType || comp.type;
            let name = comp.name || `${type} ${id}`;
            if (name === type) {
                name = `${type} ${id}`;
            }
            if (type === 'PUMP' || type === 'BLOWER') {
                let switchService = this.accessory.getServiceById(this.platform.Service.Switch, `${type.toLowerCase()}-${id}`);
                if (!switchService) {
                    switchService = this.accessory.addService(this.platform.Service.Switch, name, `${type.toLowerCase()}-${id}`);
                }
                switchService.getCharacteristic(this.platform.Characteristic.On)
                    .onGet(() => this.getPumpState(id, type))
                    .onSet((value) => this.setPumpState(id, type, value));
                this.pumpServices.set(`${type}-${id}`, switchService);
            }
            else if (type === 'LIGHT') {
                let lightService = this.accessory.getServiceById(this.platform.Service.Lightbulb, `light-${id}`);
                if (!lightService) {
                    lightService = this.accessory.addService(this.platform.Service.Lightbulb, name, `light-${id}`);
                }
                lightService.getCharacteristic(this.platform.Characteristic.On)
                    .onGet(() => this.getLightState(id))
                    .onSet((value) => this.setLightState(id, value));
                this.lightServices.set(id, lightService);
            }
        }
    }
    onStateUpdated(spaData) {
        this.accessory.context.spaData = spaData;
        this.platform.log.debug('Updating HomeKit characteristics from background poll');
        // Update Thermostat
        this.thermostatService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.extractCurrentTemp(spaData));
        this.thermostatService.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.extractTargetTemp(spaData));
        this.thermostatService.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.computeHeatingState(spaData));
        // Update Pumps & Lights
        const components = spaData?.currentState?.components;
        if (components) {
            for (const comp of components) {
                const id = comp.port || comp.id;
                const type = comp.componentType || comp.type;
                const value = comp.value; // typically "OFF", "LOW", "HIGH" or "ON"
                if ((type === 'PUMP' || type === 'BLOWER') && this.pumpServices.has(`${type}-${id}`)) {
                    const isOn = value !== 'OFF' && value !== 0 && value !== '0';
                    this.pumpServices.get(`${type}-${id}`).updateCharacteristic(this.platform.Characteristic.On, isOn);
                }
                else if (type === 'LIGHT' && this.lightServices.has(id)) {
                    const isOn = value !== 'OFF' && value !== 0 && value !== '0';
                    this.lightServices.get(id).updateCharacteristic(this.platform.Characteristic.On, isOn);
                }
            }
        }
    }
    // --- Helper parsers ---
    extractCurrentTemp(spaData) {
        if (spaData?.currentState?.currentTemp !== undefined) {
            const fahrenheit = parseFloat(spaData.currentState.currentTemp);
            return (fahrenheit - 32) * 5 / 9; // HomeKit always expects Celsius
        }
        return 30; // Fallback
    }
    extractTargetTemp(spaData) {
        if (spaData?.currentState?.desiredTemp !== undefined) {
            const fahrenheit = parseFloat(spaData.currentState.desiredTemp);
            return (fahrenheit - 32) * 5 / 9; // HomeKit always expects Celsius
        }
        return 30; // Fallback
    }
    computeHeatingState(spaData) {
        const current = this.extractCurrentTemp(spaData);
        const target = this.extractTargetTemp(spaData);
        // Sometimes the API provides explicit heaterMode: "READY" or "REST" or heater status
        const heaterMode = spaData?.currentState?.heaterMode;
        if (heaterMode === 'HEATING' || target > current) {
            return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        }
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
    getComponentValue(type, id) {
        const spaData = this.accessory.context.spaData;
        const components = spaData?.currentState?.components;
        if (components) {
            const comp = components.find((c) => (c.componentType === type || c.type === type) && (c.port === id || c.id === id));
            if (comp)
                return comp.value;
        }
        return 'OFF';
    }
    // --- Getters (Instant from Cache) ---
    async getCurrentTemperature() {
        return this.extractCurrentTemp(this.accessory.context.spaData);
    }
    async getTargetTemperature() {
        return this.extractTargetTemp(this.accessory.context.spaData);
    }
    async getCurrentHeatingCoolingState() {
        return this.computeHeatingState(this.accessory.context.spaData);
    }
    async getTargetHeatingCoolingState() {
        const state = this.computeHeatingState(this.accessory.context.spaData);
        // Map Current State to Target State
        return state === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
            ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT
            : this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    }
    async getPumpState(id, type = 'PUMP') {
        const value = this.getComponentValue(type, id);
        return value !== 'OFF' && String(value) !== '0';
    }
    async getLightState(id) {
        const value = this.getComponentValue('LIGHT', id);
        return value !== 'OFF' && String(value) !== '0';
    }
    // --- Setters (Optimistic Update + Cloud API Request) ---
    async setTargetTemperature(value) {
        const tempC = value;
        const tempF = Math.round((tempC * 9 / 5) + 32);
        const spaId = this.accessory.context.spaId;
        // Optimistic Update
        if (!this.accessory.context.spaData.currentState)
            this.accessory.context.spaData.currentState = {};
        this.accessory.context.spaData.currentState.desiredTemp = tempF.toString();
        this.platform.log.info(`Setting target temperature to ${tempC}°C (${tempF}°F)`);
        try {
            await this.platform.controlMySpaApi.setTemp(spaId, tempF);
        }
        catch (error) {
            this.platform.log.error('Failed to set target temperature', error);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async setTargetHeatingCoolingState(value) {
        // Usually spa heaters are auto-managed by the target temp.
        // If user turns it "OFF", we could drop the target temp, but it's safer to just log it.
        this.platform.log.info(`TargetHeatingCoolingState set to: ${value} (Note: Mostly managed by target temperature)`);
    }
    async setPumpState(id, type, value) {
        const isOn = value;
        const spaId = this.accessory.context.spaId;
        const targetState = isOn ? 'LOW' : 'OFF';
        // Optimistic Update
        const components = this.accessory.context.spaData.currentState?.components;
        const comp = components?.find((c) => (c.port === id || c.id === id) && (c.componentType === type || c.type === type));
        if (comp)
            comp.value = targetState;
        this.platform.log.info(`Setting ${type} ${id} to ${targetState}`);
        try {
            if (type === 'BLOWER') {
                await this.platform.controlMySpaApi.setBlowerState(spaId, id, targetState);
            }
            else {
                await this.platform.controlMySpaApi.setPumpState(spaId, id, targetState, type);
            }
        }
        catch (error) {
            this.platform.log.error(`Failed to set ${type} ${id}`, error);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async setLightState(id, value) {
        const isOn = value;
        const spaId = this.accessory.context.spaId;
        const targetState = isOn ? 'ON' : 'OFF';
        // Optimistic Update
        const components = this.accessory.context.spaData.currentState?.components;
        const comp = components?.find((c) => c.port === id || c.id === id);
        if (comp)
            comp.value = targetState;
        this.platform.log.info(`Setting Light ${id} to ${targetState}`);
        try {
            await this.platform.controlMySpaApi.setLightState(spaId, id, targetState);
        }
        catch (error) {
            this.platform.log.error(`Failed to set Light ${id}`, error);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
}
exports.SpaPlatformAccessory = SpaPlatformAccessory;

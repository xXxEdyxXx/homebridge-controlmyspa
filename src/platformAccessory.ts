import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { ControlMySpaPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SpaPlatformAccessory {
  private thermostatService: Service;
  private lightServices: Map<string, Service> = new Map();
  private pumpServices: Map<string, Service> = new Map();

  constructor(
    private readonly platform: ControlMySpaPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
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
  private setupDynamicComponents() {
    const spaData = this.accessory.context.spaData;
    const components = spaData?.currentState?.components;
    if (!components) return;

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
      } else if (type === 'LIGHT') {
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

  public onStateUpdated(spaData: any) {
    this.accessory.context.spaData = spaData;
    this.platform.log.debug('Updating HomeKit characteristics from background poll');
    
    // Update Thermostat
    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature, 
      this.extractCurrentTemp(spaData)
    );
    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature, 
      this.extractTargetTemp(spaData)
    );
    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState, 
      this.computeHeatingState(spaData)
    );

    // Update Pumps & Lights
    const components = spaData?.currentState?.components;
    if (components) {
      for (const comp of components) {
        const id = comp.port || comp.id;
        const type = comp.componentType || comp.type;
        const value = comp.value; // typically "OFF", "LOW", "HIGH" or "ON"

        if ((type === 'PUMP' || type === 'BLOWER') && this.pumpServices.has(`${type}-${id}`)) {
          const isOn = value !== 'OFF' && value !== 0 && value !== '0';
          this.pumpServices.get(`${type}-${id}`)!.updateCharacteristic(this.platform.Characteristic.On, isOn);
        } else if (type === 'LIGHT' && this.lightServices.has(id)) {
           const isOn = value !== 'OFF' && value !== 0 && value !== '0';
           this.lightServices.get(id)!.updateCharacteristic(this.platform.Characteristic.On, isOn);
        }
      }
    }
  }

  // --- Helper parsers ---
  private extractCurrentTemp(spaData: any): number {
    if (spaData?.currentState?.currentTemp !== undefined) {
      const fahrenheit = parseFloat(spaData.currentState.currentTemp);
      return (fahrenheit - 32) * 5 / 9; // HomeKit always expects Celsius
    }
    return 30; // Fallback
  }

  private extractTargetTemp(spaData: any): number {
    if (spaData?.currentState?.desiredTemp !== undefined) {
      const fahrenheit = parseFloat(spaData.currentState.desiredTemp);
      return (fahrenheit - 32) * 5 / 9; // HomeKit always expects Celsius
    }
    return 30; // Fallback
  }

  private computeHeatingState(spaData: any): number {
    const current = this.extractCurrentTemp(spaData);
    const target = this.extractTargetTemp(spaData);
    
    // Sometimes the API provides explicit heaterMode: "READY" or "REST" or heater status
    const heaterMode = spaData?.currentState?.heaterMode;
    
    if (heaterMode === 'HEATING' || target > current) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  private getComponentValue(type: string, id: string): string {
    const spaData = this.accessory.context.spaData;
    const components = spaData?.currentState?.components;
    if (components) {
      const comp = components.find((c: any) => 
        (c.componentType === type || c.type === type) && (c.port === id || c.id === id)
      );
      if (comp) return comp.value;
    }
    return 'OFF';
  }

  // --- Getters (Instant from Cache) ---
  
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.extractCurrentTemp(this.accessory.context.spaData);
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    return this.extractTargetTemp(this.accessory.context.spaData);
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.computeHeatingState(this.accessory.context.spaData);
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    const state = this.computeHeatingState(this.accessory.context.spaData);
    // Map Current State to Target State
    return state === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT 
      ? this.platform.Characteristic.TargetHeatingCoolingState.HEAT 
      : this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
  }

  async getPumpState(id: string, type: string = 'PUMP'): Promise<CharacteristicValue> {
    const value = this.getComponentValue(type, id);
    return value !== 'OFF' && String(value) !== '0';
  }

  async getLightState(id: string): Promise<CharacteristicValue> {
    const value = this.getComponentValue('LIGHT', id);
    return value !== 'OFF' && String(value) !== '0';
  }

  // --- Setters (Optimistic Update + Cloud API Request) ---

  async setTargetTemperature(value: CharacteristicValue) {
    const tempC = value as number;
    const tempF = Math.round((tempC * 9 / 5) + 32);
    const spaId = this.accessory.context.spaId;
    
    // Optimistic Update
    if (!this.accessory.context.spaData.currentState) this.accessory.context.spaData.currentState = {};
    this.accessory.context.spaData.currentState.desiredTemp = tempF.toString();
    
    this.platform.log.info(`Setting target temperature to ${tempC}°C (${tempF}°F)`);
    try {
      await this.platform.controlMySpaApi.setTemp(spaId, tempF);
    } catch (error) {
      this.platform.log.error('Failed to set target temperature', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    // Usually spa heaters are auto-managed by the target temp.
    // If user turns it "OFF", we could drop the target temp, but it's safer to just log it.
    this.platform.log.info(`TargetHeatingCoolingState set to: ${value} (Note: Mostly managed by target temperature)`);
  }

  async setPumpState(id: string, type: string, value: CharacteristicValue) {
    const isOn = value as boolean;
    const spaId = this.accessory.context.spaId;
    const targetState = isOn ? 'ON' : 'OFF';
    
    // Optimistic Update
    const components = this.accessory.context.spaData.currentState?.components;
    const comp = components?.find((c: any) => (c.port === id || c.id === id) && (c.componentType === type || c.type === type));
    if (comp) comp.value = targetState;

    this.platform.log.info(`Setting ${type} ${id} to ${targetState}`);
    try {
      if (type === 'BLOWER') {
        await this.platform.controlMySpaApi.setBlowerState(spaId, id, targetState as any);
      } else {
        await this.platform.controlMySpaApi.setPumpState(spaId, id, targetState, type);
      }
    } catch (error) {
      this.platform.log.error(`Failed to set ${type} ${id}`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setLightState(id: string, value: CharacteristicValue) {
    const isOn = value as boolean;
    const spaId = this.accessory.context.spaId;
    const targetState = isOn ? 'ON' : 'OFF';
    
    // Optimistic Update
    const components = this.accessory.context.spaData.currentState?.components;
    const comp = components?.find((c: any) => c.port === id || c.id === id);
    if (comp) comp.value = targetState;

    this.platform.log.info(`Setting Light ${id} to ${targetState}`);
    try {
      await this.platform.controlMySpaApi.setLightState(spaId, id, targetState);
    } catch (error) {
      this.platform.log.error(`Failed to set Light ${id}`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}

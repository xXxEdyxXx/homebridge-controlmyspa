import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SpaPlatformAccessory } from './platformAccessory';
import { ControlMySpaApi } from './controlMySpaApi';

/**
 * ControlMySpaPlatform
 */
export class ControlMySpaPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Track registered accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly spaAccessories: Map<string, SpaPlatformAccessory> = new Map();

  public controlMySpaApi!: ControlMySpaApi;
  private pollInterval!: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);

    // Ensure config is present
    if (!config.email || !config.password) {
      this.log.error('Email or Password missing in config. Plugin will not start.');
      return;
    }

    this.controlMySpaApi = new ControlMySpaApi(config.email, config.password, this.log);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
      
      const intervalMs = this.config.pollingInterval || 300000; // 5 min default
      this.pollInterval = setInterval(this.pollSpaState.bind(this), intervalMs);
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Discover and register the spa accessory
   */
  async discoverDevices() {
    try {
      const spasResponse = await this.controlMySpaApi.getSpas();
      
      // Attempt to extract the spa from the response
      // ControlMySpa usually returns { _embedded: { spas: [ { _id: "...", ... } ] } }
      // Or an array directly.
      let spas = [];
      if (Array.isArray(spasResponse)) {
        spas = spasResponse;
      } else if (spasResponse.data && Array.isArray(spasResponse.data.spas)) {
        spas = spasResponse.data.spas;
      } else if (spasResponse._embedded && Array.isArray(spasResponse._embedded.spas)) {
        spas = spasResponse._embedded.spas;
      } else if (spasResponse.spas && Array.isArray(spasResponse.spas)) {
        spas = spasResponse.spas;
      } else {
        // Fallback, treat the object as the single spa
        spas = [spasResponse];
      }

      if (spas.length === 0) {
        this.log.warn('No spas found for this account.');
        return;
      }

      const spa = spas[0];
      const spaId = spa._id || spa.id || 'default_spa_id';
      const spaName = spa.name || 'ControlMySpa Hot Tub';

      const uuid = this.api.hap.uuid.generate(spaId);

      // Check if it already exists in cache
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        // Store the initial state on the accessory context so the accessory class can use it
        existingAccessory.context.spaData = spa;
        existingAccessory.context.spaId = spaId;
        this.spaAccessories.set(uuid, new SpaPlatformAccessory(this, existingAccessory));
      } else {
        this.log.info('Adding new accessory:', spaName);
        const accessory = new this.api.platformAccessory(spaName, uuid);
        accessory.context.spaData = spa;
        accessory.context.spaId = spaId;
        this.spaAccessories.set(uuid, new SpaPlatformAccessory(this, accessory));
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }

    } catch (error) {
      this.log.error('Failed to discover devices:', error);
    }
  }

  /**
   * Background polling function to fetch the latest state from the cloud
   */
  async pollSpaState() {
    try {
      this.log.debug('Polling ControlMySpa API for state updates...');
      const spasResponse = await this.controlMySpaApi.getSpas();
      
      let spas = [];
      if (Array.isArray(spasResponse)) {
        spas = spasResponse;
      } else if (spasResponse.data && Array.isArray(spasResponse.data.spas)) {
        spas = spasResponse.data.spas;
      } else if (spasResponse._embedded && Array.isArray(spasResponse._embedded.spas)) {
        spas = spasResponse._embedded.spas;
      } else if (spasResponse.spas && Array.isArray(spasResponse.spas)) {
        spas = spasResponse.spas;
      } else {
        spas = [spasResponse];
      }

      if (spas.length > 0) {
        const spa = spas[0];
        const spaId = spa._id || spa.id || 'default_spa_id';
        const uuid = this.api.hap.uuid.generate(spaId);

        const spaAcc = this.spaAccessories.get(uuid);
        if (spaAcc) {
          spaAcc.onStateUpdated(spa);
        }
      }
    } catch (error) {
      this.log.error('Error polling spa state:', error);
    }
  }
}

import axios, { AxiosInstance } from 'axios';

export class ControlMySpaApi {
  private email: string;
  private password: string;
  private axiosInstance: AxiosInstance;
  private token: string | null = null;
  private idm: any = null;

  constructor(email: string, password: string, public log: any) {
    this.email = email;
    this.password = password;
    this.axiosInstance = axios.create({
      baseURL: 'https://iot.controlmyspa.com',
      timeout: 15000,
    });
  }

  private async getIdm() {
    if (this.idm) return this.idm;
    try {
      const response = await this.axiosInstance.get('/idm/tokenEndpoint');
      this.idm = response.data;
      return this.idm;
    } catch (error) {
      this.log.error('Failed to get IDM token endpoint', error);
      throw error;
    }
  }

  private async authenticate() {
    const idm = await this.getIdm();
    try {
      const tokenUrl = idm._links.tokenEndpoint.href;
      const clientId = idm.mobileClientId;
      const clientSecret = idm.mobileClientSecret;
      
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('password', this.password);
      params.append('scope', 'openid user_name');
      params.append('email', this.email);

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const token = response.data?.data?.accessToken || response.data?.access_token;
      if (!token) {
        throw new Error('Token missing from authentication response: ' + JSON.stringify(response.data));
      }
      this.token = token;
      this.log.info('Successfully authenticated with ControlMySpa');
    } catch (error) {
      this.log.error('Authentication failed', error);
      throw error;
    }
  }

  private async request(method: 'GET' | 'POST', endpoint: string, data?: any): Promise<any> {
    if (!this.token) {
      await this.authenticate();
    }

    try {
      const response = await this.axiosInstance({
        method,
        url: endpoint,
        data,
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
      });
      return response.data;
    } catch (error: any) {
      if (error.response && error.response.status === 401) {
        this.log.warn('Token expired, re-authenticating...');
        this.token = null;
        return this.request(method, endpoint, data); // Retry once
      }
      this.log.error(`API request failed [${method} ${endpoint}]`, error.response?.data || error.message);
      throw error;
    }
  }

  public async getSpas() {
    const data = await this.request('GET', `/spas?username=${encodeURIComponent(this.email)}`);
    // Usually it returns an array of spas or an object with a _embedded.spas array.
    // We will return the raw data and let the platform handle it.
    return data;
  }

  public async setTemp(spaId: string, temp: number) {
    const endpoint = `/spa-commands/temperature/value`;
    return this.request('POST', endpoint, { value: temp, spaId: spaId, via: 'MOBILE' });
  }

  public async setLightState(spaId: string, port: string, state: 'ON' | 'OFF') {
    const endpoint = `/spa-command/component-state`;
    return this.request('POST', endpoint, { 
      state: state === 'ON' ? 'HIGH' : 'OFF', 
      deviceNumber: parseInt(port, 10) || 0, 
      componentType: 'light', 
      spaId: spaId, 
      via: 'MOBILE' 
    });
  }

  public async setPumpState(spaId: string, port: string, state: 'OFF' | 'LOW' | 'HIGH') {
    const endpoint = `/spa-command/component-state`;
    return this.request('POST', endpoint, { 
      state: state, 
      deviceNumber: parseInt(port, 10) || 0, 
      componentType: 'jet', 
      spaId: spaId, 
      via: 'MOBILE' 
    });
  }
}

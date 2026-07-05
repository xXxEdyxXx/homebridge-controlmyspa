"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlMySpaApi = void 0;
const axios_1 = __importDefault(require("axios"));
class ControlMySpaApi {
    log;
    email;
    password;
    axiosInstance;
    token = null;
    idm = null;
    constructor(email, password, log) {
        this.log = log;
        this.email = email;
        this.password = password;
        this.axiosInstance = axios_1.default.create({
            baseURL: 'https://iot.controlmyspa.com',
            timeout: 15000,
        });
    }
    async getIdm() {
        if (this.idm)
            return this.idm;
        try {
            const response = await this.axiosInstance.get('/idm/tokenEndpoint');
            this.idm = response.data;
            return this.idm;
        }
        catch (error) {
            this.log.error('Failed to get IDM token endpoint', error);
            throw error;
        }
    }
    async authenticate() {
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
            const response = await axios_1.default.post(tokenUrl, params.toString(), {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });
            this.token = response.data.access_token;
            this.log.info('Successfully authenticated with ControlMySpa');
        }
        catch (error) {
            this.log.error('Authentication failed', error);
            throw error;
        }
    }
    async request(method, endpoint, data) {
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
        }
        catch (error) {
            if (error.response && error.response.status === 401) {
                this.log.warn('Token expired, re-authenticating...');
                this.token = null;
                return this.request(method, endpoint, data); // Retry once
            }
            this.log.error(`API request failed [${method} ${endpoint}]`, error.response?.data || error.message);
            throw error;
        }
    }
    async getSpas() {
        const data = await this.request('GET', '/spas');
        // Usually it returns an array of spas or an object with a _embedded.spas array.
        // We will return the raw data and let the platform handle it.
        return data;
    }
    // Best guess endpoints based on common ControlMySpa wrapper logic.
    // We POST to the specific control endpoints.
    async setTemp(spaId, temp) {
        const endpoint = `/spas/${spaId}/control/tempTarget`;
        return this.request('POST', endpoint, { tempTarget: temp });
    }
    async setLightState(spaId, port, state) {
        const endpoint = `/spas/${spaId}/components/light/${port}`;
        return this.request('POST', endpoint, { state });
    }
    async setPumpState(spaId, port, state) {
        const endpoint = `/spas/${spaId}/components/pump/${port}`;
        return this.request('POST', endpoint, { state });
    }
}
exports.ControlMySpaApi = ControlMySpaApi;

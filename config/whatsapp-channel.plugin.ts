/**
 * WhatsApp Channel Plugin for OpenClaw
 * Integrates Evolution API for WhatsApp messaging
 */

import axios from 'axios';

interface WhatsAppMessage {
  id: string;
  from: string;
  text: string;
  timestamp: number;
  isFromMe: boolean;
}

interface WhatsAppResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export class WhatsAppChannel {
  private evolutionApiUrl: string;
  private phoneNumber: string;
  private axiosInstance: any;

  constructor(config: {
    evolutionApiUrl: string;
    phoneNumber: string;
  }) {
    this.evolutionApiUrl = config.evolutionApiUrl;
    this.phoneNumber = config.phoneNumber;

    this.axiosInstance = axios.create({
      baseURL: this.evolutionApiUrl,
      timeout: 10000,
    });
  }

  /**
   * Initialize WhatsApp session (scan QR code)
   */
  async initialize(): Promise<WhatsAppResponse> {
    try {
      const response = await this.axiosInstance.post('/api/v1/messages/initialize', {
        instance: 'lyra-whatsapp',
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error('WhatsApp initialization error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send a message via WhatsApp
   */
  async sendMessage(to: string, text: string): Promise<WhatsAppResponse> {
    try {
      const response = await this.axiosInstance.post('/api/v1/messages/send', {
        instance: 'lyra-whatsapp',
        to: to,
        text: text,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error('WhatsApp send error:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get recent messages from a contact
   */
  async getMessages(from: string, limit: number = 50): Promise<WhatsAppMessage[]> {
    try {
      const response = await this.axiosInstance.get('/api/v1/messages/fetch', {
        params: {
          instance: 'lyra-whatsapp',
          from: from,
          limit: limit,
        },
      });
      return response.data.messages || [];
    } catch (error: any) {
      console.error('WhatsApp fetch error:', error.message);
      return [];
    }
  }

  /**
   * Check if instance is connected
   */
  async isConnected(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/api/v1/health', {
        params: { instance: 'lyra-whatsapp' },
      });
      return response.data.status === 'connected';
    } catch {
      return false;
    }
  }

  /**
   * Get QR code for authentication
   */
  async getQRCode(): Promise<string | null> {
    try {
      const response = await this.axiosInstance.get('/api/v1/messages/qrcode', {
        params: { instance: 'lyra-whatsapp' },
      });
      return response.data.qrcode;
    } catch (error: any) {
      console.error('WhatsApp QR code error:', error.message);
      return null;
    }
  }

  /**
   * Disconnect instance
   */
  async disconnect(): Promise<WhatsAppResponse> {
    try {
      const response = await this.axiosInstance.post('/api/v1/messages/disconnect', {
        instance: 'lyra-whatsapp',
      });
      return { success: true };
    } catch (error: any) {
      console.error('WhatsApp disconnect error:', error.message);
      return { success: false, message: error.message };
    }
  }
}

export default WhatsAppChannel;

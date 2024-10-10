import axios from 'axios';
import payshigaConfig from '../config/payshiga';
import { Transaction } from '../entities/Transaction';
import { Wallet } from '../entities/Wallet';
import { VirtualCard } from '../entities/virtualCard';
import { KYCData } from '../../types/kyc';

const apiClient = axios.create({
  baseURL: payshigaConfig.baseUrl,
  headers: {
    'Authorization': `Bearer ${payshigaConfig.apiKey}`,
    'Content-Type': 'application/json',
  },
});

class PayshigaService {
  async createWallet(userId: string, currency: 'USD' | 'GBP' | 'NGN'): Promise<Wallet | null> {
    try {
      const response = await apiClient.post('/accounts/generate', {
        customerId: userId,
        currency
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Creating wallet failed');
      return null; // Ensure function returns a value
    }
  }

  async sendMoney(senderWalletId: string, recipientWalletId: string, amount: number, currency: 'USD' | 'GBP' | 'NGN', description: string): Promise<Transaction | null> {
    try {
      const response = await apiClient.post('/transactions/send', {
        senderWalletId,
        recipientWalletId,
        amount,
        currency,
        description,
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Sending money failed');
      return null; // Ensure function returns a value
    }
  }

  async receiveMoney(walletId: string, amount: number, currency: 'USD' | 'GBP' | 'NGN', transactionRef: string): Promise<Transaction | null> {
    try {
      const response = await apiClient.post('/transactions/receive', {
        walletId,
        amount,
        currency,
        transactionRef,
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Receiving money failed');
      return null; // Ensure function returns a value
    }
  }

  async convertCurrency(sourceWalletId: string, targetWalletId: string, amount: number): Promise<{ convertedAmount: number } | null> {
    try {
      const response = await apiClient.get('/exchange-rate/quote', {
        params: {
          sourceWalletId,
          targetWalletId,
          amount,
        },
      });
      const { convertedAmount } = response.data;
      return { convertedAmount };
    } catch (error: any) {
      this.handleApiError(error, 'Currency conversion failed');
      return null; // Ensure function returns a value
    }
  }

  async createVirtualCard(amount: number, userId: string, reference: string): Promise<VirtualCard | null> {
    try {
      const response = await apiClient.post('/virtual-card/create', {
        amount,
        customerId: userId,
        reference,
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Creating virtual card failed');
      return null; // Ensure function returns a value
    }
  }

  async lockVirtualCard(cardId: string, userId: string, reference: string): Promise<any> {
    try {
      const response = await apiClient.post('/virtual-card/lock', {
        cardId,
        customerId: userId,
        reference,
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Locking virtual card failed');
      return null; // Ensure function returns a value
    }
  }

  async getBanks(currency: string): Promise<any | null> {
    try {
      const response = await apiClient.get(`/banks/${currency}`);
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Fetching banks failed');
      return null; // Ensure function returns a value
    }
  }

  async getExchangeRate(amount: number, currencyFrom: string, currencyTo: string): Promise<any | null> {
    try {
      const response = await apiClient.get('/exchange-rate', {
        params: { amount, currencyFrom, currencyTo },
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Fetching exchange rate failed');
      return null; // Ensure function returns a value
    }
  }

  async transferMoney(transferData: any): Promise<any | null> {
    try {
      const response = await apiClient.post('/transfer-money', transferData);
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Transferring money failed');
      return null; // Ensure function returns a value
    }
  }

  async verifyKYC(userId: string, kycData: KYCData): Promise<any> {
    try {
      const response = await apiClient.post('/kyc/verify', {
        customerId: userId,
        ...kycData,
      });
      return response.data;
    } catch (error: any) {
      this.handleApiError(error, 'Verifying KYC failed');
      return null;
    }
  }

  private handleApiError(error: any, errorMessage: string): void {
    console.error(`${errorMessage}:`, error);
    throw new Error(errorMessage);
  }
}



export default new PayshigaService();

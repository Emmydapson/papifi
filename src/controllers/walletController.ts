import { Request, Response } from 'express';
import payshigaService from '../services/walletService';

class WalletController {
  validateRequestBody(requiredFields: string[], body: any): string | null {
    for (const field of requiredFields) {
      if (!body[field]) return field;
    }
    return null;
  }

  async createWallet(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['userId', 'currency', 'phoneNumber', 'email', 'reference'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { userId, currency } = req.body;
    try {
      const wallet = await payshigaService.createWallet(userId, currency);
      res.status(201).json(wallet);
    } catch (error: any) {
      console.error('Error creating wallet:', error);
      res.status(500).json({ message: 'Error creating wallet', error: error.message });
    }
  }

  async sendMoney(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['senderWalletId', 'recipientWalletId', 'amount', 'currency'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { senderWalletId, recipientWalletId, amount, currency, description } = req.body;
    try {
      const transaction = await payshigaService.sendMoney(senderWalletId, recipientWalletId, amount, currency, description);
      res.status(201).json(transaction);
    } catch (error: any) {
      console.error('Error sending money:', error);
      res.status(500).json({ message: 'Error sending money', error: error.message });
    }
  }

  async receiveMoney(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['walletId', 'amount', 'currency', 'transactionRef'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { walletId, amount, currency, transactionRef } = req.body;
    try {
      const transaction = await payshigaService.receiveMoney(walletId, amount, currency, transactionRef);
      res.status(200).json(transaction);
    } catch (error: any) {
      console.error('Error receiving money:', error);
      res.status(500).json({ message: 'Error receiving money', error: error.message });
    }
  }

  async convertCurrency(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['sourceWalletId', 'targetWalletId', 'amount'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { sourceWalletId, targetWalletId, amount } = req.body;
    try {
      const conversionResult = await payshigaService.convertCurrency(sourceWalletId, targetWalletId, amount);
      res.status(200).json(conversionResult);
    } catch (error: any) {
      console.error('Error converting currency:', error);
      res.status(500).json({ message: 'Error converting currency', error: error.message });
    }
  }

  async createVirtualCard(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['walletId', 'amount', 'reference'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { amount, reference } = req.body;
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'User is not authenticated' });
    }

    try {
      const virtualCard = await payshigaService.createVirtualCard(amount, userId, reference);
      res.status(201).json(virtualCard);
    } catch (error: any) {
      console.error('Error creating virtual card:', error);
      res.status(500).json({ message: 'Error creating virtual card', error: error.message });
    }
  }

  async lockVirtualCard(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['cardId', 'userId', 'reference'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { cardId, userId, reference } = req.body;
    try {
      const result = await payshigaService.lockVirtualCard(cardId, userId, reference);
      res.status(200).json({ message: 'Virtual card locked successfully', result });
    } catch (error: any) {
      console.error('Error locking virtual card:', error);
      res.status(500).json({ message: 'Error locking virtual card', error: error.message });
    }
  }

  async getBanks(req: Request, res: Response) {
    const { currency } = req.params;
    if (!currency) {
      return res.status(400).json({ message: 'Currency is required' });
    }

    try {
      const banks = await payshigaService.getBanks(currency);
      res.status(200).json(banks);
    } catch (error: any) {
      console.error('Error fetching banks:', error);
      res.status(500).json({ message: 'Error fetching banks', error: error.message });
    }
  }

  async getExchangeRate(req: Request, res: Response) {
    const missingField = this.validateRequestBody(['amount', 'currencyFrom', 'currencyTo'], req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    const { amount, currencyFrom, currencyTo } = req.body;
    try {
      const rate = await payshigaService.getExchangeRate(amount, currencyFrom, currencyTo);
      res.status(200).json(rate);
    } catch (error: any) {
      console.error('Error fetching exchange rate:', error);
      res.status(500).json({ message: 'Error fetching exchange rate', error: error.message });
    }
  }

  async transferMoney(req: Request, res: Response) {
    const requiredFields = [
      'accountNumber', 'amount', 'bankCode', 'currency', 
      'narration', 'accountName', 'bankName', 'reference'
    ];
    const missingField = this.validateRequestBody(requiredFields, req.body);
    if (missingField) {
      return res.status(400).json({ message: `${missingField} is required` });
    }

    try {
      const transferResult = await payshigaService.transferMoney(req.body);
      res.status(200).json(transferResult);
    } catch (error: any) {
      console.error('Error transferring money:', error);
      res.status(500).json({ message: 'Error transferring money', error: error.message });
    }
  }
}

export default new WalletController();

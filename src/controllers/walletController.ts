import { Request, Response } from 'express';
import payshigaService from '../services/walletService';

class PayshigaController {
  async createWallet(req: Request, res: Response) {
    const { userId, currency, phoneNumber, email, reference } = req.body;
    if (!userId || !currency || !phoneNumber || !email || !reference) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    try {
      const wallet = await payshigaService.createWallet(userId, currency);
      res.status(201).json(wallet);
    } catch (error: any) {
      console.error('Error creating wallet:', error);
      res.status(500).json({ message: 'Error creating wallet', error: error.message });
    }
  }

  async sendMoney(req: Request, res: Response) {
    const { senderWalletId, recipientWalletId, amount, currency, description } = req.body;
    if (!senderWalletId || !recipientWalletId || !amount || !currency) {
      return res.status(400).json({ message: 'senderWalletId, recipientWalletId, amount, and currency are required' });
    }
    try {
      const transaction = await payshigaService.sendMoney(senderWalletId, recipientWalletId, amount, currency, description);
      res.status(201).json(transaction);
    } catch (error: any) {
      console.error('Error sending money:', error);
      res.status(500).json({ message: 'Error sending money', error: error.message });
    }
  }

  async receiveMoney(req: Request, res: Response) {
    const { walletId, amount, currency, transactionRef } = req.body;
    if (!walletId || !amount || !currency || !transactionRef) {
      return res.status(400).json({ message: 'walletId, amount, currency, and transactionRef are required' });
    }
    try {
      const transaction = await payshigaService.receiveMoney(walletId, amount, currency, transactionRef);
      res.status(200).json(transaction);
    } catch (error: any) {
      console.error('Error receiving money:', error);
      res.status(500).json({ message: 'Error receiving money', error: error.message });
    }
  }

  async convertCurrency(req: Request, res: Response) {
    const { sourceWalletId, targetWalletId, amount } = req.body;
    if (!sourceWalletId || !targetWalletId || !amount) {
      return res.status(400).json({ message: 'sourceWalletId, targetWalletId, and amount are required' });
    }
    try {
      const conversionResult = await payshigaService.convertCurrency(sourceWalletId, targetWalletId, amount);
      res.status(200).json(conversionResult);
    } catch (error: any) {
      console.error('Error converting currency:', error);
      res.status(500).json({ message: 'Error converting currency', error: error.message });
    }
  }

  async createVirtualCard(req: Request, res: Response) {
    const { walletId, amount, reference } = req.body;
    if (!walletId || !amount || !reference) {
      return res.status(400).json({ message: 'walletId, amount, and reference are required' });
    }
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(400).json({ message: 'User is not authenticated' });
      }
      const virtualCard = await payshigaService.createVirtualCard(amount, userId, reference);
      res.status(201).json(virtualCard);
    } catch (error: any) {
      console.error('Error creating virtual card:', error);
      res.status(500).json({ message: 'Error creating virtual card', error: error.message });
    }
  }

  async lockVirtualCard(req: Request, res: Response) {
    const { cardId, userId, reference } = req.body;
    if (!cardId || !userId || !reference) {
      return res.status(400).json({ message: 'cardId, userId, and reference are required' });
    }
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
    const { amount, currencyFrom, currencyTo } = req.body;
    if (!amount || !currencyFrom || !currencyTo) {
      return res.status(400).json({ message: 'Amount, currencyFrom, and currencyTo are required' });
    }
    try {
      const rate = await payshigaService.getExchangeRate(amount, currencyFrom, currencyTo);
      res.status(200).json(rate);
    } catch (error: any) {
      console.error('Error fetching exchange rate:', error);
      res.status(500).json({ message: 'Error fetching exchange rate', error: error.message });
    }
  }

  async transferMoney(req: Request, res: Response) {
    const {
      accountNumber, amount, bankCode, currency, narration,
      accountName, bankName, meta, reference, saveBeneficiary, saveBeneficiaryTag
    } = req.body;

    if (!accountNumber || !amount || !bankCode || !currency || !narration || !accountName || !bankName || !reference) {
      return res.status(400).json({ message: 'All required fields must be provided' });
    }

    const transferData = {
      accountNumber, amount, bankCode, currency, narration,
      accountName, bankName, meta, reference, saveBeneficiary, saveBeneficiaryTag,
    };

    try {
      const transferResult = await payshigaService.transferMoney(transferData);
      res.status(200).json(transferResult);
    } catch (error: any) {
      console.error('Error transferring money:', error);
      res.status(500).json({ message: 'Error transferring money', error: error.message });
    }
  }
}

export default new PayshigaController();
                                                                                                                                                                                                                                                                                                                                                    
// src/controllers/walletController.ts
import { Request, Response } from 'express';
import { createWallet } from '../services/walletService'; // Adjust import path as necessary

export const createWalletController = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    await createWallet(userId);

    res.status(201).json({ message: 'Wallet created successfully' });
  } catch (error) {
    console.error('Error creating wallet:', error);
    res.status(500).json({ message: 'Error creating wallet' });
  }
};

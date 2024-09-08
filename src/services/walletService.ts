import { Wallet } from '../entities/Wallet';
import { AppDataSource } from '../database';
import { User } from '../entities/User';  // Import the User entity

export const createWallet = async (userId: string) => {
  const walletRepository = AppDataSource.getRepository(Wallet);
  const userRepository = AppDataSource.getRepository(User);

  // Find the user by userId
  const user = await userRepository.findOne({ where: { id: userId } });

  if (!user) {
    throw new Error('User not found');
  }

  const wallet = walletRepository.create({
    user, // Link the wallet to the user entity
    NGN: 0,
    GBP: 0,
    EUR: 0,
    USD: 0,
  });

  await walletRepository.save(wallet);
};

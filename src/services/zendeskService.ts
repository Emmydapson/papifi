// src/services/zendeskService.ts
import axios from 'axios';

const ZENDESK_API_URL = 'https://your-zendesk-domain.zendesk.com/api/v2/tickets.json';
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

export const createSupportTicket = async (userEmail: string, subject: string, description: string) => {
  try {
    const response = await axios.post(
      ZENDESK_API_URL,
      {
        ticket: {
          requester: {
            email: userEmail,
          },
          subject,
          comment: { body: description },
        },
      },
      {
        auth: {
          username: `${ZENDESK_EMAIL}/token`,
          password: ZENDESK_API_TOKEN,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Failed to create support ticket:', error);
    throw new Error('Failed to create support ticket');
  }
};

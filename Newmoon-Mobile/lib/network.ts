import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import NetInfo from '@react-native-community/netinfo';
import Echo from 'laravel-echo';
import PusherModule from 'pusher-js/react-native';
import { getToken, deleteToken } from './authStorage';
import { deleteUser } from './userStorage';

export const APP_HOST = '192.168.254.105';
export const API_PORT = 8000;
export const API_ORIGIN = `http://${APP_HOST}:${API_PORT}`;
export const API_BASE_URL = `${API_ORIGIN}/api`;
export const STORAGE_URL = `${API_ORIGIN}/storage`;
export const WS_HOST = APP_HOST;
export const WS_PORT = 8080;
export const REVERB_KEY = 'newmoon-app-key';
export const BROADCAST_AUTH_URL = `${API_ORIGIN}/broadcasting/auth`;

export type PublicRequestConfig = Omit<InternalAxiosRequestConfig, 'headers'> & {
  allowWhileSignedOut?: boolean;
  headers?: InternalAxiosRequestConfig['headers'];
};

let onAuthError: (() => void) | null = null;
let sessionEnded = false;

export const isSignedOut = () => sessionEnded;

export const setSignedOut = (signedOut: boolean) => {
  sessionEnded = signedOut;
};

export const isSessionEndedError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 401 || response?.status === 403;
};

export const setOnAuthError = (cb: (() => void) | null) => {
  onAuthError = cb;
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const config = error.config as PublicRequestConfig | undefined;

    if (config?.allowWhileSignedOut) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      setSignedOut(true);
      await deleteToken();
      await deleteUser();
      if (onAuthError) onAuthError();
    }
    return Promise.reject(error);
  }
);

export default api;

export async function hasNetworkConnection(): Promise<boolean> {
  const state = await NetInfo.fetch();
  const isConnected = state.isConnected === true;
  console.log('[NETWORK] Connection status:', isConnected, 'Details:', state);
  return isConnected;
}

export async function isOnline(): Promise<boolean> {
  return hasNetworkConnection();
}

export function subscribeToNetwork(callback: (online: boolean) => void) {
  return NetInfo.addEventListener((state) => {
    callback(state.isConnected === true);
  });
}

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; code?: string; response?: unknown };
  if (err.response) return false;
  const message = String(err.message ?? '').toLowerCase();
  const code = String(err.code ?? '');
  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ERR_INTERNET_DISCONNECTED' ||
    message.includes('network error') ||
    message.includes('network request failed') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('connection refused') ||
    message.includes('unable to connect')
  );
}

export function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { response?: { status?: number } };
  return err.response?.status === 401;
}

const Pusher = (PusherModule as any).Pusher ?? PusherModule;

let echo: Echo<any> | null = null;

export const getEcho = async (): Promise<Echo<any> | null> => {
  echo = new Echo({
    broadcaster: 'pusher',
    client: new Pusher(REVERB_KEY, {
      cluster: 'mt1',
      wsHost: WS_HOST,
      wsPort: WS_PORT,
      wssPort: WS_PORT,
      forceTLS: false,
      enabledTransports: ['ws', 'wss'],
      authEndpoint: BROADCAST_AUTH_URL,
      auth: {
        headers: {
          Authorization: `Bearer ${await getToken()}`,
          Accept: 'application/json',
        },
      },
    }),
    disableStats: true,
  });

  return echo;
};

export const listenToOrder = (
  orderId: number | string,
  event: string,
  callback: (data: any) => void
): (() => void) => {
  let channel: any = null;
  let cancelled = false;

  const init = async () => {
    const instance = echo || (await getEcho());
    if (!instance || cancelled) return;
    channel = instance.private(`order.${orderId}`);
    channel.listen(event, (data: any) => callback(data));
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      channel.stopListening(event);
      channel.disconnect?.();
    }
  };
};

export const listenToStaffOrders = (callback: (data: any) => void): (() => void) => {
  let channel: any = null;
  let cancelled = false;

  const init = async () => {
    const instance = echo || (await getEcho());
    if (!instance || cancelled) return;
    channel = instance.private('staff.orders');
    channel.listen('.OrderStatusUpdated', (data: any) => callback(data));
    channel.listen('.NewOrderCreated', (data: any) => callback(data));
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      channel.stopListening('.OrderStatusUpdated');
      channel.stopListening('.NewOrderCreated');
      channel.disconnect?.();
    }
  };
};

export const listenToRider = (
  riderId: number | string,
  callback: (data: any) => void
): (() => void) => {
  let channel: any = null;
  let cancelled = false;

  const init = async () => {
    const instance = echo || (await getEcho());
    if (!instance || cancelled) return;
    channel = instance.private(`rider.${riderId}`);
    channel.listen('.OrderStatusUpdated', (data: any) => callback(data));
    channel.listen('.NewOrderCreated', (data: any) => callback(data));
    channel.listen('.RiderAssigned', (data: any) => callback(data));
  };

  init();

  return () => {
    cancelled = true;
    if (channel) {
      channel.stopListening('.OrderStatusUpdated');
      channel.stopListening('.NewOrderCreated');
      channel.stopListening('.RiderAssigned');
      channel.disconnect?.();
    }
  };
};

export const disconnectEcho = () => {
  if (echo) {
    echo.disconnect();
    echo = null;
  }
};

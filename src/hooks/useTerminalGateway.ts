import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TerminalClient,
  type TerminalCapabilities,
  type TerminalSessionInfo,
  type TerminalReadiness,
  type ConnectionState,
  getDefaultGatewayUrl
} from '../lib/terminalClient';

export interface UseTerminalGatewayOptions {
  gatewayUrl?: string;
  autoConnect?: boolean;
}

export function useTerminalGateway(options: UseTerminalGatewayOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [capabilities, setCapabilities] = useState<TerminalCapabilities | null>(null);
  const [sessionInfo, setSessionInfo] = useState<TerminalSessionInfo | null>(null);
  const [outputStream, setOutputStream] = useState<string>('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [gatewayReadiness, setGatewayReadiness] = useState<TerminalReadiness | null>(null);
  const [isProbing, setIsProbing] = useState<boolean>(false);

  const clientRef = useRef<TerminalClient | null>(null);
  const outputListenersRef = useRef(new Set<(chunk: string) => void>());

  const gatewayUrl = options.gatewayUrl || getDefaultGatewayUrl();

  const probeReadiness = useCallback(async (): Promise<TerminalReadiness> => {
    if (!clientRef.current) {
      return { success: false, ready: false, configured: false, error: 'Terminal client not initialized' };
    }
    setIsProbing(true);
    try {
      const readiness = await clientRef.current.checkReadiness();
      setGatewayReadiness(readiness);
      if (!readiness.ready && readiness.error) {
        setLastError(readiness.error);
      }
      return readiness;
    } finally {
      setIsProbing(false);
    }
  }, []);

  // Initialize and check gateway availability
  useEffect(() => {
    const client = new TerminalClient(gatewayUrl, {
      onOutput: (chunk) => {
        setOutputStream((prev) => (prev + chunk).slice(-2 * 1024 * 1024));
        outputListenersRef.current.forEach(listener => listener(chunk));
      },
      onSessionReady: (info) => {
        setSessionInfo(info);
        setLastError(null);
      },
      onStateChange: (state) => {
        setConnectionState(state);
      },
      onError: (err) => {
        setLastError(err);
      },
      onClose: () => {
        setSessionInfo(null);
      }
    });

    clientRef.current = client;
    void probeReadiness();

    return () => {
      client.disconnect();
    };
  }, [gatewayUrl, probeReadiness]);

  const connect = useCallback(() => {
    if (!clientRef.current) return;
    setOutputStream('');
    setLastError(null);
    void clientRef.current.connect().then(async () => {
      const caps = await clientRef.current?.checkCapabilities();
      if (caps) setCapabilities(caps);
    });
  }, []);

  const disconnect = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.disconnect();
  }, []);

  const sendInput = useCallback((data: string) => {
    if (!clientRef.current) return;
    clientRef.current.sendInput(data);
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (!clientRef.current) return;
    clientRef.current.sendResize(cols, rows);
  }, []);

  const clearOutput = useCallback(() => {
    setOutputStream('');
  }, []);

  const subscribeOutput = useCallback((listener: (chunk: string) => void) => {
    outputListenersRef.current.add(listener);
    return () => outputListenersRef.current.delete(listener);
  }, []);

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting',
    capabilities,
    sessionInfo,
    outputStream,
    lastError,
    gatewayReadiness,
    isProbing,
    probeReadiness,
    connect,
    disconnect,
    sendInput,
    sendResize,
    clearOutput,
    subscribeOutput
  };
}

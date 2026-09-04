import React, { createContext, useContext, useState, ReactNode } from 'react';
import { playClickSound, playErrorBeep, playSuccessChime } from '../lib/soundEngine';

interface AlertContextType {
  showAlert: (message: string, title?: string, icon?: 'info' | 'warning' | 'error' | 'question' | 'success', onOk?: () => void) => void;
  showConfirm: (message: string, onConfirm: () => void, title?: string) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    icon: 'info' | 'warning' | 'error' | 'question' | 'success';
    onOk?: () => void;
    isConfirm?: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const showAlert = (
    message: string,
    title = "Nate's Software 95",
    icon: 'info' | 'warning' | 'error' | 'question' | 'success' = 'info',
    onOk?: () => void
  ) => {
    if (icon === 'error') playErrorBeep();
    else if (icon === 'success') playSuccessChime();
    else playClickSound();

    setAlertState({
      isOpen: true,
      title,
      message,
      icon,
      onOk
    });
  };

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    title = "Confirm Action"
  ) => {
    playClickSound();
    setAlertState({
      isOpen: true,
      title,
      message,
      icon: 'question',
      isConfirm: true,
      onConfirm
    });
  };

  const handleClose = () => {
    playClickSound();
    if (alertState?.onOk) alertState.onOk();
    setAlertState(null);
  };

  const handleConfirm = () => {
    playClickSound();
    if (alertState?.onConfirm) alertState.onConfirm();
    setAlertState(null);
  };

  const getIconElement = (type: string) => {
    switch (type) {
      case 'warning':
        return <span className="text-3xl text-yellow-600">⚠️</span>;
      case 'error':
        return <span className="text-3xl text-red-600">❌</span>;
      case 'success':
        return <span className="text-3xl text-green-600">✅</span>;
      case 'question':
        return <span className="text-3xl text-blue-600">❓</span>;
      case 'info':
      default:
        return <span className="text-3xl text-blue-600">ℹ️</span>;
    }
  };

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}

      {alertState && alertState.isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1px] select-none p-4">
          <div
            className="w-full max-w-[420px] bg-w95-gray w95-border w95-shadow flex flex-col font-tahoma text-xs shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-gradient-to-r from-[#000080] via-[#1084d0] to-[#000080] text-white px-3 py-1 flex items-center justify-between font-bold text-sm">
              <span className="truncate">{alertState.title}</span>
              <button
                onClick={handleClose}
                className="w-4 h-4 bg-w95-gray w95-border text-black font-bold flex items-center justify-center text-[10px] hover:bg-red-700 hover:text-white"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-5 flex items-start gap-4 bg-w95-gray">
              <div className="shrink-0 mt-0.5">
                {getIconElement(alertState.icon)}
              </div>
              <div className="flex-1 text-gray-900 text-sm font-sans whitespace-pre-wrap leading-relaxed">
                {alertState.message}
              </div>
            </div>

            <div className="p-3 bg-w95-gray border-t border-gray-300 flex justify-center gap-3">
              {alertState.isConfirm ? (
                <>
                  <button
                    onClick={handleConfirm}
                    className="btn-w95 btn-w95-primary px-6 py-1.5 font-bold text-xs shadow-sm ring-1 ring-black/20"
                    autoFocus
                  >
                    OK
                  </button>
                  <button
                    onClick={handleClose}
                    className="btn-w95 px-6 py-1.5 font-bold text-xs"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={handleClose}
                  className="btn-w95 btn-w95-primary px-8 py-1.5 font-bold text-xs shadow-sm ring-1 ring-black/20"
                  autoFocus
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
};

export const useAlert = (): AlertContextType => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

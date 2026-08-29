import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { AlertProvider } from '../src/context/AlertContext';

describe('application provider boundary', () => {
  it('renders the complete application tree with auth consumers inside AuthProvider', () => {
    expect(() => renderToString(
      <AlertProvider>
        <App />
      </AlertProvider>
    )).not.toThrow(/useAuth must be used within an AuthProvider/);
  });
});

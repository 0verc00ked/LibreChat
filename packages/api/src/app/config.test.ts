import { getTransactionsConfig, getBalanceConfig, getCustomEndpointConfig } from './config';
import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, FileSources } from 'librechat-data-provider';
import type { TCustomConfig, TEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

// Helper function to create a minimal AppConfig for testing
const createTestAppConfig = (overrides: Partial<AppConfig> = {}): AppConfig => {
  const minimalConfig: TCustomConfig = {
    version: '1.0.0',
    cache: true,
    interface: {
      endpointsMenu: true,
    },
    registration: {
      socialLogins: [],
    },
    endpoints: {},
  };

  return {
    config: minimalConfig,
    paths: {
      uploads: '',
      imageOutput: '',
      publicPath: '',
    },
    fileStrategy: FileSources.local,
    fileStrategies: {},
    imageOutputType: 'png',
    ...overrides,
  };
};

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

jest.mock('~/utils', () => ({
  isEnabled: jest.fn((value) => value === 'true'),
}));

describe('getTransactionsConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CHECK_BALANCE;
    delete process.env.START_BALANCE;
  });

  describe('when appConfig is not provided', () => {
    it('should return default config with enabled: true', () => {
      const result = getTransactionsConfig();
      expect(result).toEqual({ enabled: true });
    });
  });

  describe('when appConfig is provided', () => {
    it('should return transactions config when explicitly set to false', () => {
      const appConfig = createTestAppConfig({
        transactions: { enabled: false },
        balance: { enabled: false },
      });
      const result = getTransactionsConfig(appConfig);
      expect(result).toEqual({ enabled: false });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should return transactions config when explicitly set to true', () => {
      const appConfig = createTestAppConfig({
        transactions: { enabled: true },
        balance: { enabled: false },
      });
      const result = getTransactionsConfig(appConfig);
      expect(result).toEqual({ enabled: true });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should return default config when transactions is not defined', () => {
      const appConfig = createTestAppConfig({
        balance: { enabled: false },
      });
      const result = getTransactionsConfig(appConfig);
      expect(result).toEqual({ enabled: true });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    describe('balance and transactions interaction', () => {
      it('should force transactions to be enabled when balance is enabled but transactions is disabled', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
          balance: { enabled: true },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: true });
        expect(logger.warn).toHaveBeenCalledWith(
          'Configuration warning: transactions.enabled=false is incompatible with balance.enabled=true. ' +
            'Transactions will be enabled to ensure balance tracking works correctly.',
        );
      });

      it('should not override transactions when balance is enabled and transactions is enabled', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: true },
          balance: { enabled: true },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: true });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should allow transactions to be disabled when balance is disabled', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
          balance: { enabled: false },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: false });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should use default when balance is enabled but transactions is not defined', () => {
        const appConfig = createTestAppConfig({
          balance: { enabled: true },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: true });
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    describe('with environment variables for balance', () => {
      it('should force transactions enabled when CHECK_BALANCE env is true and transactions is false', () => {
        process.env.CHECK_BALANCE = 'true';
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: true });
        expect(logger.warn).toHaveBeenCalledWith(
          'Configuration warning: transactions.enabled=false is incompatible with balance.enabled=true. ' +
            'Transactions will be enabled to ensure balance tracking works correctly.',
        );
      });

      it('should allow transactions disabled when CHECK_BALANCE env is false', () => {
        process.env.CHECK_BALANCE = 'false';
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: false });
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should handle empty appConfig object', () => {
        const appConfig = createTestAppConfig();
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: true });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should handle appConfig with null balance', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          balance: null as any,
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: false });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should handle appConfig with undefined balance', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
          balance: undefined,
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: false });
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('should handle appConfig with balance enabled undefined', () => {
        const appConfig = createTestAppConfig({
          transactions: { enabled: false },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          balance: { enabled: undefined as any },
        });
        const result = getTransactionsConfig(appConfig);
        expect(result).toEqual({ enabled: false });
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });
});

describe('getBalanceConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CHECK_BALANCE;
    delete process.env.START_BALANCE;
  });

  describe('when appConfig is not provided', () => {
    it('should return config based on environment variables', () => {
      process.env.CHECK_BALANCE = 'true';
      process.env.START_BALANCE = '1000';
      const result = getBalanceConfig();
      expect(result).toEqual({
        enabled: true,
        startBalance: 1000,
      });
    });

    it('should return empty config when no env vars are set', () => {
      const result = getBalanceConfig();
      expect(result).toEqual({ enabled: false });
    });

    it('should handle CHECK_BALANCE true without START_BALANCE', () => {
      process.env.CHECK_BALANCE = 'true';
      const result = getBalanceConfig();
      expect(result).toEqual({
        enabled: true,
      });
    });

    it('should handle START_BALANCE without CHECK_BALANCE', () => {
      process.env.START_BALANCE = '5000';
      const result = getBalanceConfig();
      expect(result).toEqual({
        enabled: false,
        startBalance: 5000,
      });
    });
  });

  describe('when appConfig is provided', () => {
    it('should merge appConfig balance with env config', () => {
      process.env.CHECK_BALANCE = 'true';
      process.env.START_BALANCE = '1000';
      const appConfig = createTestAppConfig({
        balance: {
          enabled: false,
          startBalance: 2000,
          autoRefillEnabled: true,
        },
      });
      const result = getBalanceConfig(appConfig);
      expect(result).toEqual({
        enabled: false,
        startBalance: 2000,
        autoRefillEnabled: true,
      });
    });

    it('should use env config when appConfig balance is not provided', () => {
      process.env.CHECK_BALANCE = 'true';
      process.env.START_BALANCE = '3000';
      const appConfig = createTestAppConfig();
      const result = getBalanceConfig(appConfig);
      expect(result).toEqual({
        enabled: true,
        startBalance: 3000,
      });
    });

    it('should handle appConfig with null balance', () => {
      process.env.CHECK_BALANCE = 'true';
      const appConfig = createTestAppConfig({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        balance: null as any,
      });
      const result = getBalanceConfig(appConfig);
      expect(result).toEqual({
        enabled: true,
      });
    });
  });
});

describe('getCustomEndpointConfig', () => {
  const mockA4FConfig: Partial<TEndpoint> = {
    name: 'A4F',
    apiKey: '${A4F_API_KEY}',
    baseURL: 'https://api.a4f.co/v1',
    models: {
      default: ['provider-1/chatgpt-4o-latest', 'provider-3/claude-3-5-sonnet-20240620'],
      fetch: true,
    },
    titleConvo: true,
    titleModel: 'provider-1/chatgpt-4o-latest',
    modelDisplayLabel: 'A4F',
  };

  const createAppConfigWithCustomEndpoints = (
    customEndpoints: Partial<TEndpoint>[],
  ): AppConfig => {
    const minimalConfig: TCustomConfig = {
      version: '1.0.0',
      cache: true,
      interface: {
        endpointsMenu: true,
      },
      registration: {
        socialLogins: [],
      },
      endpoints: {
        [EModelEndpoint.custom]: customEndpoints as TEndpoint[],
      },
    };

    return {
      config: minimalConfig,
      paths: {
        uploads: '',
        imageOutput: '',
        publicPath: '',
      },
      fileStrategy: FileSources.local,
      fileStrategies: {},
      imageOutputType: 'png',
      endpoints: minimalConfig.endpoints,
    };
  };

  it('should throw error when appConfig is not provided', () => {
    expect(() =>
      getCustomEndpointConfig({ endpoint: 'A4F', appConfig: undefined }),
    ).toThrow('Config not found for the A4F custom endpoint.');
  });

  it('should return undefined when no custom endpoints are configured', () => {
    const appConfig = createAppConfigWithCustomEndpoints([]);
    const result = getCustomEndpointConfig({ endpoint: 'A4F', appConfig });
    expect(result).toBeUndefined();
  });

  it('should find A4F endpoint by exact name match', () => {
    const appConfig = createAppConfigWithCustomEndpoints([mockA4FConfig]);
    const result = getCustomEndpointConfig({ endpoint: 'A4F', appConfig });
    expect(result).toEqual(mockA4FConfig);
  });

  it('should find A4F endpoint when searching with normalized name', () => {
    // The function compares normalizeEndpointName(endpointConfig.name) === endpoint
    // So the endpoint parameter should match the normalized config name
    const appConfig = createAppConfigWithCustomEndpoints([mockA4FConfig]);
    // Since normalizeEndpointName only handles 'ollama' specially, 'A4F' stays as 'A4F'
    const result = getCustomEndpointConfig({ endpoint: 'A4F', appConfig });
    expect(result).toEqual(mockA4FConfig);
  });

  it('should return undefined when endpoint name does not match', () => {
    const appConfig = createAppConfigWithCustomEndpoints([mockA4FConfig]);
    // Lowercase 'a4f' won't match 'A4F' since normalizeEndpointName doesn't lowercase
    const result = getCustomEndpointConfig({ endpoint: 'a4f', appConfig });
    expect(result).toBeUndefined();
  });

  it('should return undefined when endpoint is not found', () => {
    const appConfig = createAppConfigWithCustomEndpoints([mockA4FConfig]);
    const result = getCustomEndpointConfig({ endpoint: 'NonExistent', appConfig });
    expect(result).toBeUndefined();
  });

  it('should find endpoint among multiple custom endpoints', () => {
    const otherEndpoint: Partial<TEndpoint> = {
      name: 'OtherProvider',
      apiKey: '${OTHER_API_KEY}',
      baseURL: 'https://api.other.com/v1',
    };
    const appConfig = createAppConfigWithCustomEndpoints([otherEndpoint, mockA4FConfig]);
    const result = getCustomEndpointConfig({ endpoint: 'A4F', appConfig });
    expect(result).toEqual(mockA4FConfig);
  });

  it('should handle appConfig with undefined endpoints', () => {
    const appConfig: AppConfig = {
      config: {
        version: '1.0.0',
        cache: true,
        interface: { endpointsMenu: true },
        registration: { socialLogins: [] },
        endpoints: {},
      },
      paths: { uploads: '', imageOutput: '', publicPath: '' },
      fileStrategy: FileSources.local,
      fileStrategies: {},
      imageOutputType: 'png',
      endpoints: undefined,
    };
    const result = getCustomEndpointConfig({ endpoint: 'A4F', appConfig });
    expect(result).toBeUndefined();
  });

  it('should normalize ollama endpoint name for matching', () => {
    const ollamaConfig: Partial<TEndpoint> = {
      name: 'Ollama',
      baseURL: 'http://localhost:11434',
    };
    const appConfig = createAppConfigWithCustomEndpoints([ollamaConfig]);
    // normalizeEndpointName('Ollama') returns 'ollama'
    const result = getCustomEndpointConfig({ endpoint: 'ollama', appConfig });
    expect(result).toEqual(ollamaConfig);
  });
});

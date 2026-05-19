import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the pi-ai module
const mockComplete = vi.fn();
const mockGetModel = vi.fn();
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: mockGetModel,
  complete: mockComplete,
}));

// Mock the logging module
const mockLogTokenUsage = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/logging/index.js', () => ({
  logTokenUsage: mockLogTokenUsage,
}));

import type { AgentModelConfig } from '../src/types/index.js';

const baseConfig: AgentModelConfig = {
  model: 'test-model',
  temperature: 0.7,
  max_tokens: 4096,
};

describe('model/client', () => {
  let callModel: typeof import('../src/model/client.js').callModel;
  let setModelOverrides: typeof import('../src/model/client.js').setModelOverrides;
  let resolveAgentConfig: typeof import('../src/model/client.js').resolveAgentConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/model/client.js');
    callModel = mod.callModel;
    setModelOverrides = mod.setModelOverrides;
    resolveAgentConfig = mod.resolveAgentConfig;
    // Reset overrides
    setModelOverrides([]);

    mockGetModel.mockReturnValue({ id: 'test-model' });
  });

  describe('setModelOverrides / resolveAgentConfig', () => {
    it('returns original config when no overrides match', () => {
      setModelOverrides([]);
      const result = resolveAgentConfig(baseConfig, 'ideator', 5);
      expect(result).toBe(baseConfig);
    });

    it('applies override when agent and iteration match', () => {
      setModelOverrides([
        { agent: 'ideator', model: 'override-model', start_iteration: 1, end_iteration: 10, label: 'test' },
      ]);
      const result = resolveAgentConfig(baseConfig, 'ideator', 5);
      expect(result.model).toBe('override-model');
      expect(result.temperature).toBe(baseConfig.temperature);
    });

    it('does not apply override when iteration is outside range', () => {
      setModelOverrides([
        { agent: 'ideator', model: 'override-model', start_iteration: 1, end_iteration: 3, label: 'test' },
      ]);
      const result = resolveAgentConfig(baseConfig, 'ideator', 5);
      expect(result).toBe(baseConfig);
    });

    it('does not apply override when agent does not match', () => {
      setModelOverrides([
        { agent: 'critic', model: 'override-model', start_iteration: 1, end_iteration: 10, label: 'test' },
      ]);
      const result = resolveAgentConfig(baseConfig, 'ideator', 5);
      expect(result).toBe(baseConfig);
    });
  });

  describe('callModel', () => {
    it('calls complete and returns text with usage', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'hello world' }],
        usage: { input: 100, output: 50 },
        stopReason: 'end_turn',
      });

      const result = await callModel(baseConfig, 'system prompt', 'user msg', 1, 'ideator');
      expect(result.text).toBe('hello world');
      expect(result.usage).toEqual({ input: 100, output: 50 });
      expect(mockLogTokenUsage).toHaveBeenCalledOnce();
    });

    it('throws on model error stopReason', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'error' }],
        usage: { input: 10, output: 5 },
        stopReason: 'error',
        errorMessage: 'something broke',
      });

      await expect(callModel(baseConfig, 'sys', 'usr', 1, 'test')).rejects.toThrow('Model error: something broke');
    });

    it('throws on API error and increments backoff', async () => {
      mockComplete.mockRejectedValueOnce(new Error('API timeout'));

      await expect(callModel(baseConfig, 'sys', 'usr', 1, 'test')).rejects.toThrow('API timeout');
    });

    it('concatenates multiple text content blocks', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'part1' },
          { type: 'tool_use', text: 'ignored' },
          { type: 'text', text: 'part2' },
        ],
        usage: { input: 10, output: 10 },
        stopReason: 'end_turn',
      });

      const result = await callModel(baseConfig, 'sys', 'usr', 1, 'test');
      expect(result.text).toBe('part1part2');
    });

    it('uses resolved agent config with overrides', async () => {
      setModelOverrides([
        { agent: 'ideator', model: 'fancy-model', start_iteration: 1, end_iteration: 100, label: 'ab-test' },
      ]);

      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'result' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      });

      await callModel(baseConfig, 'sys', 'usr', 5, 'ideator');
      expect(mockGetModel).toHaveBeenCalledWith('zai', 'fancy-model');
    });

    it('handles error stopReason with no errorMessage', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: '' }],
        usage: { input: 10, output: 5 },
        stopReason: 'error',
      });

      await expect(callModel(baseConfig, 'sys', 'usr', 1, 'test')).rejects.toThrow('Model error: unknown');
    });
  });
});

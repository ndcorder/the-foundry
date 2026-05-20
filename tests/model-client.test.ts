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

const baseConfigWithProvider: AgentModelConfig = {
  model: 'test-model',
  provider: 'openai-codex',
  temperature: 0.5,
  max_tokens: 8192,
};

describe('model/client', () => {
  let callModel: typeof import('../src/model/client.js').callModel;
  let setModelOverrides: typeof import('../src/model/client.js').setModelOverrides;
  let resolveAgentConfig: typeof import('../src/model/client.js').resolveAgentConfig;
  let resetModelState: typeof import('../src/model/client.js').resetModelState;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/model/client.js');
    callModel = mod.callModel;
    setModelOverrides = mod.setModelOverrides;
    resolveAgentConfig = mod.resolveAgentConfig;
    resetModelState = mod.resetModelState;
    // Reset overrides
    setModelOverrides([]);

    mockGetModel.mockReturnValue({ id: 'test-model' });
    resetModelState();
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

    it('defaults provider to zai when not specified', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      });

      await callModel(baseConfig, 'sys', 'usr', 1, 'test');
      expect(mockGetModel).toHaveBeenCalledWith('zai', 'test-model');
    });

    it('passes configured provider to getModel', async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      });

      await callModel(baseConfigWithProvider, 'sys', 'usr', 1, 'test');
      expect(mockGetModel).toHaveBeenCalledWith('openai-codex', 'test-model');
    });

    it('uses provider in cache key so same model on different providers is not shared', async () => {
      const successResponse = {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      };
      mockComplete.mockResolvedValue(successResponse);

      // Call with default provider (zai)
      await callModel(baseConfig, 'sys', 'usr', 1, 'test');
      expect(mockGetModel).toHaveBeenCalledWith('zai', 'test-model');

      // Call with explicit provider — should NOT reuse cache
      await callModel(baseConfigWithProvider, 'sys', 'usr', 2, 'test');
      expect(mockGetModel).toHaveBeenCalledWith('openai-codex', 'test-model');
      expect(mockGetModel).toHaveBeenCalledTimes(2);
    });

    it('resets backoff state via resetModelState', async () => {
      // Trigger consecutive errors to build up backoff
      mockComplete.mockRejectedValueOnce(new Error('fail1'));
      await expect(callModel(baseConfig, 'sys', 'usr', 1, 'test')).rejects.toThrow('fail1');
      mockComplete.mockRejectedValueOnce(new Error('fail2'));
      await expect(callModel(baseConfig, 'sys', 'usr', 1, 'test')).rejects.toThrow('fail2');

      // Reset state
      resetModelState();

      // Next call should proceed without backoff delay
      const start = Date.now();
      mockComplete.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      });
      await callModel(baseConfig, 'sys', 'usr', 1, 'test');
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it('clears model cache via resetModelState', async () => {
      const successResponse = {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      };
      mockComplete.mockResolvedValue(successResponse);

      // First call with model-a populates cache
      const configA = { ...baseConfig, model: 'model-a' };
      await callModel(configA, 'sys', 'usr', 1, 'test');
      const callsAfterFirst = mockGetModel.mock.calls.length;

      // Second call reuses cache — no new getModel call
      await callModel(configA, 'sys', 'usr', 2, 'test');
      expect(mockGetModel.mock.calls.length).toBe(callsAfterFirst);

      // Reset clears cache
      resetModelState();

      // Third call must re-resolve the model
      await callModel(configA, 'sys', 'usr', 3, 'test');
      expect(mockGetModel.mock.calls.length).toBe(callsAfterFirst + 1);
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

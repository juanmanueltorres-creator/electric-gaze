import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  fromContract,
  readConfig,
  toContract,
  type OutputState,
} from '../src/ui/contract';
import { DEFAULT_PARAMS } from '../src/defaults';
import type { Params } from '../src/types';

const view: OutputState = { framing: 'vertical', width: 405.4, height: 720 };

describe('toContract', () => {
  it('carries params, the schema version and a normalised view block', () => {
    const doc = toContract(DEFAULT_PARAMS, view);
    expect(doc.cellSize).toBe(DEFAULT_PARAMS.cellSize);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.output).toEqual({ framing: 'vertical', width: 405, height: 720 });
  });

  it('wins over stray document keys sitting inside params', () => {
    const doc = toContract(
      { ...DEFAULT_PARAMS, schemaVersion: 99, output: 'nope' } as unknown as Params,
      view,
    );
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof doc.output).toBe('object');
  });
});

describe('fromContract', () => {
  it('strips both document-level keys and keeps the params', () => {
    const { params, output } = fromContract(toContract(DEFAULT_PARAMS, view));
    expect(params).not.toHaveProperty('schemaVersion');
    expect(params).not.toHaveProperty('output');
    expect((params as Record<string, unknown>).cellSize).toBe(DEFAULT_PARAMS.cellSize);
    expect(output).toEqual({ framing: 'vertical', width: 405, height: 720 });
  });

  it('reads a document that predates the view block', () => {
    expect(fromContract({ cellSize: 17 }).output).toBeNull();
  });

  it('tolerates a malformed view block instead of failing the split', () => {
    expect(fromContract({ cellSize: 17, output: 'nope' }).output).toBeNull();
  });
});

describe('readConfig', () => {
  it('accepts the document this build writes', () => {
    const { params, output } = readConfig(toContract(DEFAULT_PARAMS, view));
    expect((params as Record<string, unknown>).cellSize).toBe(DEFAULT_PARAMS.cellSize);
    expect(output?.framing).toBe('vertical');
  });

  it('accepts a params-only document with no schema version', () => {
    expect(readConfig({ cellSize: 17 }).params).toHaveProperty('cellSize', 17);
  });

  it.each([null, 'text', 7, [1, 2, 3]])('rejects %j as not an object', (bad) => {
    expect(() => readConfig(bad)).toThrow('a config must be a JSON object');
  });

  it('rejects an unsupported schema version', () => {
    expect(() => readConfig({ schemaVersion: 99, cellSize: 1 })).toThrow(
      `schemaVersion 99 is not supported (this build writes ${SCHEMA_VERSION})`,
    );
  });

  it('rejects a present-but-malformed view block', () => {
    expect(() => readConfig({ cellSize: 5, output: { framing: 'nope' } })).toThrow(
      'the "output" block is malformed',
    );
  });
});

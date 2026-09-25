import { beforeEach, describe, expect, it, vi } from 'vitest';
import { delegateToCallingAgent } from '../src/mastra/agents/heytam/remote-tools.js';
import { assertTenantAccess, normalizeTenantId } from '../src/mastra/utils/tenant-access.js';

vi.mock('pg', () => {
  const query = vi.fn().mockResolvedValue({
    rowCount: 1,
    rows: [{ table_name: 'mastra_memory' }],
  });
  const connect = vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);

  function MockClient() {
    return { connect, query, end };
  }

  return {
    Client: MockClient,
    __mock: { query, connect, end },
  };
});

describe('Orchestration integration tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries HTTP delegation calls and includes tenant scoping for each attempt', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'scheduled' }),
      } as Response);

    vi.stubGlobal('fetch', fetchMock);

    const result = await delegateToCallingAgent.execute({
      prompt: 'Call the top 5 urgent leads.',
      tenantId: 'tenant-acme',
    });

    expect(result).toEqual({ result: 'scheduled' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.tenantId).toBe('tenant-acme');
  });

  it('rejects unauthorized tenant IDs before executing the supervisor route', () => {
    expect(() => assertTenantAccess('tenant-bad')).toThrow(/not authorized/i);
    expect(normalizeTenantId(' tenant-acme ')).toBe('tenant-acme');
  });

  it('runs migration and persistence checks against the configured database connection', async () => {
    const { runMastraMigrations, checkMastraPersistence } = await import('../src/mastra/storage/migrations.js');
    const { __mock } = await import('pg');

    await runMastraMigrations('postgresql://localhost:5432/test');
    await checkMastraPersistence('postgresql://localhost:5432/test');

    expect(__mock.connect).toHaveBeenCalledTimes(2);
    expect(__mock.query).toHaveBeenCalled();
  });
});

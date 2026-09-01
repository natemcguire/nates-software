import type {
  CommandExecResult,
  CommandExecOptions,
  DockerCommandRunner
} from '../../src/lib/rigDockerProvider';

export type MockHandler = (
  file: string,
  args: readonly string[],
  options?: CommandExecOptions
) => CommandExecResult | Promise<CommandExecResult>;

/**
 * Injectable mock runner for unit and integration testing without a running Docker daemon.
 * Kept in test fixtures so test mock infrastructure never leaks into the production bundle.
 */
export class MockDockerCommandRunner implements DockerCommandRunner {
  public recordedCalls: Array<{ file: string; args: string[]; options?: CommandExecOptions }> = [];
  private handlers: Map<string, MockHandler> = new Map();
  public defaultHandler?: MockHandler;

  public setHandler(subcommand: string, handler: MockHandler): void {
    this.handlers.set(subcommand, handler);
  }

  public clearHandlers(): void {
    this.handlers.clear();
    this.recordedCalls = [];
  }

  public async exec(
    file: string,
    args: readonly string[],
    options?: CommandExecOptions
  ): Promise<CommandExecResult> {
    this.recordedCalls.push({ file, args: [...args], options });

    const subcommand = args[0] || '';
    const handler = this.handlers.get(subcommand) || this.defaultHandler;

    if (handler) {
      return handler(file, args, options);
    }

    // Default canned responses for standard Docker CLI subcommands
    if (subcommand === 'version') {
      return {
        stdout: JSON.stringify({
          Client: { Version: '29.4.0' },
          Server: { Version: '29.4.0' }
        }),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'create') {
      return {
        stdout: 'c_mock_' + Math.random().toString(36).substring(2, 12),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'start' || subcommand === 'stop' || subcommand === 'rm') {
      return {
        stdout: args[args.length - 1] || 'ok',
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'inspect') {
      const target = args[args.length - 1] || 'mock';
      return {
        stdout: JSON.stringify([
          {
            Id: target,
            Name: `/${target}`,
            State: {
              Status: 'running',
              Running: true,
              OOMKilled: false,
              ExitCode: 0,
              StartedAt: new Date().toISOString(),
              FinishedAt: '0001-01-01T00:00:00Z',
              Error: ''
            },
            Config: {
              Labels: {
                'rig.managed': 'true',
                'rig.instance.id': target.replace(/^rig-box-/, ''),
                'rig.owner.id': 'nate-corp',
                'rig.expires.at': new Date(Date.now() + 900000).toISOString()
              }
            }
          }
        ]),
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'ps') {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'logs') {
      return {
        stdout: `[mock-log] Application initialized on port 3001\n[mock-log] Ready for connections\n`,
        stderr: '',
        exitCode: 0
      };
    }

    if (subcommand === 'run') {
      const isSmokeCheck = args.some(a => typeof a === 'string' && (a.includes('statusCode') || a.includes('http.createServer')));
      if (isSmokeCheck) {
        return {
          stdout: JSON.stringify({ passed: true, statusCode: 200, responseSnippet: 'OK' }),
          stderr: '',
          exitCode: 0
        };
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0
      };
    }

    return {
      stdout: '',
      stderr: '',
      exitCode: 0
    };
  }
}

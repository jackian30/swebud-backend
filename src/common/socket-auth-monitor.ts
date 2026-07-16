import type { Socket } from 'socket.io';

export const SOCKET_AUTH_REVALIDATE_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

type Timer = ReturnType<typeof setTimeout>;

type MonitorState = {
  stopped: boolean;
  revalidationTimer?: Timer;
  expiryTimer?: Timer;
};

export class SocketAuthMonitor {
  private readonly states = new Map<string, MonitorState>();

  start(client: Socket, accessTokenExpiresAtMs: number, validate: () => Promise<boolean>) {
    this.stop(client.id);
    const state: MonitorState = { stopped: false };
    this.states.set(client.id, state);

    const revalidate = async () => {
      if (state.stopped || this.states.get(client.id) !== state) return;
      const valid = await validate().catch(() => false);
      if (!valid) {
        this.disconnect(client);
        return;
      }
      if (state.stopped || this.states.get(client.id) !== state) return;
      state.revalidationTimer = this.timer(revalidate, SOCKET_AUTH_REVALIDATE_MS);
    };

    state.revalidationTimer = this.timer(revalidate, SOCKET_AUTH_REVALIDATE_MS);
    this.scheduleExpiry(client, accessTokenExpiresAtMs, state);
  }

  stop(socketId: string) {
    const state = this.states.get(socketId);
    if (!state) return;
    state.stopped = true;
    if (state.revalidationTimer) clearTimeout(state.revalidationTimer);
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    this.states.delete(socketId);
  }

  disconnect(client: Socket) {
    this.stop(client.id);
    client.disconnect(true);
  }

  private scheduleExpiry(client: Socket, expiresAtMs: number, state: MonitorState) {
    const remaining = expiresAtMs - Date.now();
    if (remaining <= 0) {
      this.disconnect(client);
      return;
    }
    state.expiryTimer = this.timer(() => {
      if (state.stopped || this.states.get(client.id) !== state) return;
      if (expiresAtMs > Date.now()) {
        this.scheduleExpiry(client, expiresAtMs, state);
        return;
      }
      this.disconnect(client);
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  }

  private timer(callback: () => void | Promise<void>, delay: number) {
    const timer = setTimeout(() => void callback(), delay);
    timer.unref?.();
    return timer;
  }
}

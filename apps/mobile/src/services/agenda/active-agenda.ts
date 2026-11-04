interface ActiveAgenda<T> {
  reconcile(): Promise<T>;
}

/** Follow a replacement made while registration or foreground recovery is in flight.
 * A stable runtime's errors and any account/context change remain errors. */
export async function reconcileActiveAgenda<T>(
  current: () => ActiveAgenda<T> | null,
  assertContext: () => void,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    assertContext();
    const active = current();
    if (!active) return undefined;
    try {
      const coverage = await active.reconcile();
      assertContext();
      if (current() === active) return coverage;
    } catch (error) {
      assertContext();
      if (current() === active) throw error;
    }
  }
  throw new Error('La agenda cambió durante la actualización. Vuelve a intentarlo.');
}

/**
 * Run the same piece of work over a list, several at a time but never more
 * than the given number at once.
 *
 * Written rather than borrowed because the rules matter here and a general
 * library would give us more than we want: the answers come back in the order
 * the list was given, whatever order the work finished in, and one failure
 * does not stop the rest — a folder with one damaged file in it should still
 * end up with every other file read.
 */
export const mapWithLimit = async <In, Out>(
    items: readonly In[],
    limit: number,
    work: (item: In, index: number) => Promise<Out>,
): Promise<PromiseSettledResult<Out>[]> => {
    const results: PromiseSettledResult<Out>[] = new Array(items.length);
    const atOnce = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    let next = 0;

    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next;
            next += 1;
            try {
                results[index] = { status: 'fulfilled', value: await work(items[index] as In, index) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    };

    await Promise.all(Array.from({ length: atOnce }, worker));
    return results;
};

const { withDeadlockRetry } = require('../utils/retryOnDeadlock');

function deadlockError() {
    const err = new Error('Deadlock found when trying to get lock; try restarting transaction');
    err.code = 'ER_LOCK_DEADLOCK';
    return err;
}

describe('withDeadlockRetry', () => {
    test('returns the result on the first try when nothing fails', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        const result = await withDeadlockRetry(fn, { delayMs: 1 });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on ER_LOCK_DEADLOCK and succeeds once a later attempt works', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(deadlockError())
            .mockRejectedValueOnce(deadlockError())
            .mockResolvedValueOnce('recovered');
        const result = await withDeadlockRetry(fn, { retries: 3, delayMs: 1 });
        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    test('gives up and throws after exhausting retries', async () => {
        const fn = jest.fn().mockRejectedValue(deadlockError());
        await expect(withDeadlockRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow(/Deadlock/);
        expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    });

    test('does not retry a non-deadlock error — fails immediately', async () => {
        const otherError = new Error('Something else went wrong');
        otherError.code = 'ER_DUP_ENTRY';
        const fn = jest.fn().mockRejectedValue(otherError);
        await expect(withDeadlockRetry(fn, { retries: 3, delayMs: 1 })).rejects.toThrow('Something else went wrong');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

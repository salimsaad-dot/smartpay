// MySQL's own documented guidance for a deadlock (ER_LOCK_DEADLOCK) is
// "the application should retry the transaction" — InnoDB rolls the
// losing transaction back entirely as the resolution mechanism, so there
// is nothing to "fix" about a given deadlock occurrence itself, only
// about not surfacing it to the user as a bare 500 the first time it
// happens. Hit live in production (createPaymentLink's UPDATE-then-INSERT
// on payment_links, scoped by parent_id, is exactly the kind of
// same-row-range contention pattern that occasionally deadlocks under
// InnoDB's gap locking) via the actual Send Reminder flow.
//
// fn must be self-contained — on a deadlock, its *entire* attempt
// (including getting its own connection, if any) is retried from
// scratch, since the whole transaction was already rolled back by MySQL
// before this ever sees the error.
async function withDeadlockRetry(fn, { retries = 3, delayMs = 75 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (error.code !== 'ER_LOCK_DEADLOCK' || attempt === retries) throw error;
            // Small, increasing delay so two retrying transactions don't
            // immediately re-collide in lockstep.
            await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        }
    }
    throw lastError;
}

module.exports = { withDeadlockRetry };

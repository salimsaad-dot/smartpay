const request = require('supertest');
const app = require('../server');
const db = require('../db');
const fridayJob = require('../utils/fridayJob');
const opsAlert = require('../utils/opsAlert');

// The Friday cron endpoint is loud on failure (2026-10-16): a crashed school
// or a school whose every SMS failed returns 502 (so the GitHub workflow
// fails and emails the owner); partial failures return 200 but alert.
describe('Friday cron endpoint failure reporting', () => {
    let alertSpy;
    const call = () => request(app).post('/api/cron/friday-reminders').set('x-cron-secret', process.env.CRON_SECRET);

    beforeEach(() => {
        alertSpy = jest.spyOn(opsAlert, 'alertOwner').mockResolvedValue({ sent: true });
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => db.end());

    test('all schools fine (or not due yet): 200, no alert', async () => {
        jest.spyOn(fridayJob, 'runFridayJobForAllSchools').mockResolvedValue([
            { schoolId: 1, result: { processed: 5, success: 5, failure: 0 } },
            { schoolId: 2, result: null },
        ]);
        const res = await call();
        expect(res.status).toBe(200);
        expect(res.body.more).toBe(false);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    test('a school paused or not reached: more is true, so the workflow calls again', async () => {
        jest.spyOn(fridayJob, 'runFridayJobForAllSchools').mockResolvedValue([
            { schoolId: 1, result: { processed: 40, success: 40, failure: 0, paused: true } },
            { schoolId: 2, notStarted: true },
        ]);
        const res = await call();
        expect(res.status).toBe(200);
        expect(res.body.more).toBe(true);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    test('a few failed SMS: 200, but the owner is told which school and how many', async () => {
        jest.spyOn(fridayJob, 'runFridayJobForAllSchools').mockResolvedValue([
            { schoolId: 1, result: { processed: 10, success: 8, failure: 2 } },
        ]);
        expect((await call()).status).toBe(200);
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(alertSpy.mock.calls[0][2].join(' ')).toMatch(/2 of 10 SMS failed/);
    });

    test('every SMS failed for a school: 502 and an alert', async () => {
        jest.spyOn(fridayJob, 'runFridayJobForAllSchools').mockResolvedValue([
            { schoolId: 1, result: { processed: 4, success: 0, failure: 4 } },
        ]);
        expect((await call()).status).toBe(502);
        expect(alertSpy.mock.calls[0][2].join(' ')).toMatch(/all 4 SMS failed/);
    });

    test("a school's run crashed: 502 and an alert", async () => {
        jest.spyOn(fridayJob, 'runFridayJobForAllSchools').mockResolvedValue([
            { schoolId: 1, error: 'database paused' },
            { schoolId: 2, result: { processed: 3, success: 3, failure: 0 } },
        ]);
        expect((await call()).status).toBe(502);
        expect(alertSpy.mock.calls[0][2].join(' ')).toMatch(/crashed \(database paused\)/);
    });
});

/**
 * Stand-in for the "server-only" marker when check scripts run under tsx.
 * Next resolves the real module itself; these scripts run on the server by
 * definition, so the guard has nothing to protect here.
 */
export {};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actorStorage = void 0;
exports.getContextActor = getContextActor;
exports.runWithActor = runWithActor;
const node_async_hooks_1 = require("node:async_hooks");
exports.actorStorage = new node_async_hooks_1.AsyncLocalStorage();
function getContextActor() {
    return exports.actorStorage.getStore();
}
function runWithActor(actor, fn) {
    return exports.actorStorage.run(actor, fn);
}

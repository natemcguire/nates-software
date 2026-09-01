// GET /api/payments/orders?id=...
// Index route handler for orders query parameter.

import { handleGetOrder, onRequestPost as disallowedMethod } from './[id]';

export const onRequestGet = handleGetOrder;
export const onRequestPost = disallowedMethod;
export const onRequestPut = disallowedMethod;
export const onRequestDelete = disallowedMethod;

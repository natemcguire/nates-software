import { handleGetOrder, onRequestPost as disallowedMethod } from './orders/[id]';

export const onRequestGet = handleGetOrder;
export const onRequestPost = disallowedMethod;
export const onRequestPut = disallowedMethod;
export const onRequestDelete = disallowedMethod;

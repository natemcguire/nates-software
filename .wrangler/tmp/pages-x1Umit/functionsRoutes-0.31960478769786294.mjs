import { onRequestPost as __api_payments_create_intent_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/payments/create-intent.ts"
import { onRequestPost as __api_payments_onboard_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/payments/onboard.ts"
import { onRequestPost as __api_payments_webhook_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/payments/webhook.ts"
import { onRequestGet as __api_auth_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/auth.ts"
import { onRequestPost as __api_auth_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/auth.ts"
import { onRequestGet as __api_chat_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/chat.ts"
import { onRequestPost as __api_chat_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/chat.ts"
import { onRequestGet as __api_comments_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/comments.ts"
import { onRequestPost as __api_comments_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/comments.ts"
import { onRequestGet as __api_drops_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/drops.ts"
import { onRequestPost as __api_drops_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/drops.ts"
import { onRequestGet as __api_dyno_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/dyno.ts"
import { onRequestPost as __api_dyno_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/dyno.ts"
import { onRequestGet as __api_feed_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/feed.ts"
import { onRequestGet as __api_git_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/git.ts"
import { onRequestPost as __api_git_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/git.ts"
import { onRequestGet as __api_inbox_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/inbox.ts"
import { onRequestPost as __api_inbox_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/inbox.ts"
import { onRequestGet as __api_pipeline_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/pipeline.ts"
import { onRequestPost as __api_pipeline_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/pipeline.ts"
import { onRequestGet as __api_profile_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/profile.ts"
import { onRequestPost as __api_profile_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/profile.ts"
import { onRequestGet as __api_shelf_ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/shelf.ts"
import { onRequestPost as __api_shelf_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/shelf.ts"
import { onRequestPost as __api_upvote_ts_onRequestPost } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/api/upvote.ts"
import { onRequestGet as __badge__user__ts_onRequestGet } from "/Volumes/MacMiniExtra/Projects/nates_software/functions/badge/[user].ts"

export const routes = [
    {
      routePath: "/api/payments/create-intent",
      mountPath: "/api/payments",
      method: "POST",
      middlewares: [],
      modules: [__api_payments_create_intent_ts_onRequestPost],
    },
  {
      routePath: "/api/payments/onboard",
      mountPath: "/api/payments",
      method: "POST",
      middlewares: [],
      modules: [__api_payments_onboard_ts_onRequestPost],
    },
  {
      routePath: "/api/payments/webhook",
      mountPath: "/api/payments",
      method: "POST",
      middlewares: [],
      modules: [__api_payments_webhook_ts_onRequestPost],
    },
  {
      routePath: "/api/auth",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_auth_ts_onRequestGet],
    },
  {
      routePath: "/api/auth",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_ts_onRequestPost],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_chat_ts_onRequestGet],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_chat_ts_onRequestPost],
    },
  {
      routePath: "/api/comments",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_comments_ts_onRequestGet],
    },
  {
      routePath: "/api/comments",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_comments_ts_onRequestPost],
    },
  {
      routePath: "/api/drops",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_drops_ts_onRequestGet],
    },
  {
      routePath: "/api/drops",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_drops_ts_onRequestPost],
    },
  {
      routePath: "/api/dyno",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_dyno_ts_onRequestGet],
    },
  {
      routePath: "/api/dyno",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_dyno_ts_onRequestPost],
    },
  {
      routePath: "/api/feed",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_feed_ts_onRequestGet],
    },
  {
      routePath: "/api/git",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_git_ts_onRequestGet],
    },
  {
      routePath: "/api/git",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_git_ts_onRequestPost],
    },
  {
      routePath: "/api/inbox",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_inbox_ts_onRequestGet],
    },
  {
      routePath: "/api/inbox",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_inbox_ts_onRequestPost],
    },
  {
      routePath: "/api/pipeline",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_pipeline_ts_onRequestGet],
    },
  {
      routePath: "/api/pipeline",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_pipeline_ts_onRequestPost],
    },
  {
      routePath: "/api/profile",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_profile_ts_onRequestGet],
    },
  {
      routePath: "/api/profile",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_profile_ts_onRequestPost],
    },
  {
      routePath: "/api/shelf",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_shelf_ts_onRequestGet],
    },
  {
      routePath: "/api/shelf",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_shelf_ts_onRequestPost],
    },
  {
      routePath: "/api/upvote",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_upvote_ts_onRequestPost],
    },
  {
      routePath: "/badge/:user",
      mountPath: "/badge",
      method: "GET",
      middlewares: [],
      modules: [__badge__user__ts_onRequestGet],
    },
  ]
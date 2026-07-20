/**
 * pages/index.js — the page registry.
 * app.js imports this single module and registers everything it exports.
 * Adding a page in a future milestone = create the module, add one line here.
 */
import dashboard from "./dashboard.js";
import settings from "./settings.js";
import quests from "./quests.js";
import traders from "./traders.js";
import loot from "./loot.js";
import hideout from "./hideout.js";
import maps from "./maps.js";
import ammo from "./ammo.js";
import inventory from "./inventory.js";
import progressPage from "./progress.js";
import questgraph from "./questgraph.js";
import advisor from "./advisor.js";
import raidlog from "./raidlog.js";
import crafts from "./crafts.js";
import keys from "./keys.js";
import flea from "./flea.js";
import planner from "./planner.js";
import achievements from "./achievements.js";
import storyline from "./storyline.js";

/** Ordered list consumed by app.js. Order = sidebar order. */
export const allPages = [
  dashboard,
  advisor,
  progressPage,
  raidlog,
  storyline,
  quests,
  achievements,
  loot,
  inventory,
  keys,
  flea,
  questgraph,
  traders,
  hideout,
  crafts,
  planner,
  maps,
  ammo,
  settings,
];

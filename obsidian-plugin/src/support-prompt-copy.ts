/** The five gentle support prompts — Pavlos's copy, VERBATIM from the spec
 *  note "Payment Prompt & Mechanics". This is user-authored creative prose,
 *  not UI chrome: do not rewrite, re-case, or "fix" it. Rendered as the dialog
 *  body, one paragraph per blank-line-separated block. Index = stage - 1. */
/** The spec's two verbatim dialogue options — same authored-prose status as
 *  the prompts (the sentence-case lint's "i'll" suggestion would corrupt the
 *  copy, hence constants here rather than literals at the button). */
export const SUPPORT_YES_LABEL = "Sure, I'll help!";
export const SUPPORT_NO_LABEL = "Not now, thanks.";

export const SUPPORT_PROMPTS: readonly string[] = [
  `With sincere apologies for interrupting, we were hoping you might consider supporting this plugin by upgrading to Pro for a small, onetime cost.

Liefwork was created by an independent solo developer. All proceeds go towards keeping him and his dream alive.

This app with all of its core functionalities is free to use.

Upgrading to Pro unlocks a few cosmetic upgrades and easter eggs and helps support Liefwork's future development.

Thank you and we hope you enjoy using it.`,

  `Here to bug you again just to raise the idea of supporting this plugin by upgrading to Pro for a small, onetime cost.

Liefwork was created by an independent solo developer. All proceeds go towards keeping the developer and his dream alive.

This app with all of its core functionalities is free to use.

Upgrading to Pro unlocks a few cosmetic upgrades and easter eggs and helps support Liefwork's future development.

Thank you and we hope you enjoy using it.`,

  `Oh hey! Fancy running into you here. Hey while I have you, do you think you might consider supporting this plugin by upgrading to Pro for a small, onetime cost?

Liefwork was created by an independent solo developer. All proceeds go towards keeping the developer and his dream alive.

This app with all of its core functionalities is free to use.

Upgrading to Pro unlocks a few cosmetic upgrades and easter eggs and helps support Liefwork's future development.

Thank you and I hope you enjoy using it.`,

  `Wow! You look so nice today. You look kind and generous too - just like the people who support this plugin by upgrading to Pro for a small, onetime cost.

Liefwork was created by an independent solo developer. All proceeds go towards keeping the developer and his dream alive.

This app with all of its core functionalities is free to use.

Upgrading to Pro unlocks a few cosmetic upgrades and easter eggs and helps support Liefwork's future development.

Thank you and I hope you enjoy using it.`,

  `Sooo, I know,I know, you're like: "Oh my god take a hint!" lol. My friends tell me sometimes I can't read a room. I just thought I would check one last time if you might consider supporting this plugin by upgrading to Pro for a small, onetime cost.

It'll take like 1 minute, cost about as much as 1 cup of coffee and you'll feel good about yourself every time you come here.

See, Liefwork was created by an independent solo developer. All proceeds go towards keeping the developer and his dream alive.

This app with all of its core functionalities is free to use.

Upgrading to Pro unlocks a few cosmetic upgrades and easter eggs and helps support Liefwork's future development.

Thank you and I do hope you continue to enjoy using it.`,
];

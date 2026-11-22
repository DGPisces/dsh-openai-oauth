import type { ReactNode } from 'react';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { SettingsOnboardingOwnerProps, SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client';
export interface Model {
    id: string;
    name: string;
}
/** The one-time ticket is navigated to, never fetched; tokens remain on the host. */
export declare function isAuthorizationUrl(value: unknown): value is string;
/** Never turn a malformed response into an empty cache that could be saved. */
export declare function parseModels(value: unknown): Model[] | undefined;
export interface WelcomeIdentity {
    clientId: string;
    subject: string;
}
/** Use only a signed-in identity from the same status snapshot as its flags. */
export declare function statusIdentity(value: unknown): WelcomeIdentity | undefined;
export declare function welcomeIdentity(value: unknown): WelcomeIdentity | undefined;
export declare function watchWelcome(onChange: (identity: WelcomeIdentity | undefined) => void): {
    refresh: () => void;
    dispose: () => void;
};
/** Send the identity captured when the notice was displayed, never a fresh account lookup. */
export declare function acknowledgeWelcome(identity: WelcomeIdentity): Promise<void>;
export declare function logoutOutcome(revocation: unknown): {
    message: string;
    unconfirmed: boolean;
};
export declare function OpenAiOnboarding({ explicit, complete, openSection }: SettingsOnboardingOwnerProps): ReactNode;
export declare function WelcomeHost(): ReactNode;
export declare function OpenAiOAuthSection(_props: SettingsSectionOwnerProps): ReactNode;
export declare function apply(ctx: ClientContext): void;
export declare const inject: string[];

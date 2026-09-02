import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { EphemeralLiveApp } from '../src/components/EphemeralLiveApp';
import { AppListing } from '../src/data/mockData';
import { resolveAppRoute } from '../src/App';

// The fabricated INITIAL_APPS fixture was removed pre-launch (the catalog is now
// D1-sourced). These tests exercise EphemeralLiveApp's honest draft-state rendering,
// so we build minimal honest AppListing objects inline — no invented engagement.
const draftApp = (id: string, name: string): AppListing => ({
  id,
  name,
  deploymentState: 'draft',
  deploymentError: `No deployable revision exists for ${name}. Source has not been imported into GITSMITH and built by RIG.`,
  tagline: `${name} tagline`,
  description: `${name} description`,
  author: 'nate',
  authorAvatar: '📦',
  creator: 'nate',
  creatorAvatar: '📦',
  version: 'v1.0.0',
  upvotes: 0,
  forkCount: 0,
  forks: 0,
  tags: [],
  price: 0,
  screenshots: [],
  comments: [],
});

describe('Unbundled Demos & EphemeralLiveApp Deployment Lifecycle', () => {
  describe('Honest Deployment Lifecycle Rendering (Pre-Active)', () => {
    it('renders honest draft state for unbundled wallart demo', () => {
      const wallartApp = draftApp('wallart', 'WallArt Canvas Pro');
      expect(wallartApp).toBeDefined();

      const html = renderToString(<EphemeralLiveApp app={wallartApp} />);

      // Renders honest deployment lifecycle surface
      expect(html).toContain('WallArt Canvas Pro');
      expect(html).toContain('DRAFT (UNVERIFIED)');
      expect(html).toContain('DEPLOYMENT LIFECYCLE');
      expect(html).toContain('No deployable revision exists for WallArt Canvas Pro.');
      expect(html).toContain('Source has not been imported into GITSMITH and built by RIG.');
      expect(html).toContain('Target Hostname:');
      
      // Does NOT render bundled studio or faked client sandbox
      expect(html).not.toContain('WALLART CANVAS PRO');
      expect(html).not.toContain('Living Room Wall Art Visualizer');
      expect(html).not.toContain('Client-Side Sandbox');
    });

    it('renders honest draft state for unbundled certified-mailer demo', () => {
      const mailerApp = draftApp('certified-mailer', 'Certified Mailer');
      expect(mailerApp).toBeDefined();

      const html = renderToString(<EphemeralLiveApp app={mailerApp} />);

      expect(html).toContain('Certified Mailer');
      expect(html).toContain('DRAFT (UNVERIFIED)');
      expect(html).toContain('DEPLOYMENT LIFECYCLE');
      expect(html).toContain('No deployable revision exists for Certified Mailer.');
      expect(html).toContain('Target Hostname:');

      // Does NOT render bundled studio
      expect(html).not.toContain('Client-Side Sandbox');
      expect(html).not.toContain('USPS CERTIFIED MAIL');
    });

    it('renders honest draft state for unbundled dronehunter demo', () => {
      const dronehunterApp = draftApp('dronehunter', 'DroneHunter 95');
      expect(dronehunterApp).toBeDefined();

      const html = renderToString(<EphemeralLiveApp app={dronehunterApp} />);

      expect(html).toContain('DroneHunter 95');
      expect(html).toContain('DRAFT (UNVERIFIED)');
      expect(html).toContain('DEPLOYMENT LIFECYCLE');
      expect(html).toContain('No deployable revision exists for DroneHunter 95.');
      expect(html).toContain('Target Hostname:');

      // Does NOT render hardcoded iframe until deployed
      expect(html).not.toContain('Drone Hunter Arcade Game');
    });

    it('shows an honest unavailable state for unregistered / unknown app IDs', () => {
      const unknownApp: AppListing = {
        id: 'unknown-mystery-app',
        name: 'Mystery App',
        tagline: 'Some non-existent tool',
        description: 'Not implemented',
        author: 'nate',
        authorAvatar: '❓',
        version: 'v0.1.0',
        upvotes: 1,
        forkCount: 0,
        tags: ['Unknown'],
        sqliteDatabase: '/data/mystery.sqlite',
        sqliteSize: '0 KB',
        screenshots: [],
        comments: [],
        deploymentState: 'draft',
        deploymentError: 'No deployable revision exists for Mystery App. Source has not been imported into GITSMITH and built by RIG.'
      };

      const html = renderToString(<EphemeralLiveApp app={unknownApp} />);

      expect(html).toContain('No deployable revision exists for Mystery App.');
      expect(html).toContain('Source has not been imported into GITSMITH and built by RIG.');
      expect(html).toContain('unknown-mystery-app');
      expect(html).toContain('DRAFT (UNVERIFIED)');
    });
  });

  describe('Active Verified Deployment Rendering', () => {
    it('renders the app at its resolved live host when active (not a bare /serve path)', () => {
      // An active app carries its resolved live URL from /api/drops — its real host
      // (<hostname>.nates-software.com), which the router serves for static OR container
      // apps. EphemeralLiveApp iframes that URL. It must NOT synthesize a bare
      // /serve/<id> path, which 404s for a container/Worker app and blanks the frame.
      const activeApp: AppListing = {
        id: 'wallart',
        name: 'WallArt Canvas Pro',
        tagline: 'Interactive Canvas Split',
        description: 'Deployed wall art app',
        author: 'nate',
        authorAvatar: '🖼️',
        version: 'v1.0.0',
        upvotes: 345,
        forkCount: 52,
        tags: ['Wall Art'],
        screenshots: [],
        comments: [],
        deploymentState: 'active',
        activeDeploymentId: 'drev_wallart_prod_001',
        activeCommitOid: 'abcdef1234567890',
        liveUrl: 'https://wallart.nates-software.com/'
      };

      const html = renderToString(<EphemeralLiveApp app={activeApp} />);

      expect(html).toContain('ACTIVE (VERIFIED DEPLOYMENT)');
      expect(html).toContain('Open published app');
      expect(html).toContain('src="https://wallart.nates-software.com/"');
      expect(html).not.toContain('src="/serve/wallart/index.html"');
      expect(html).toContain('title="WallArt Canvas Pro"');
      expect(html).not.toContain('No deployable revision exists');
    });

    it('falls through to the honest surface for an active app with no resolved live URL', () => {
      // Defensive: if an active app somehow has no live URL, we render the honest
      // deployment surface rather than iframing a bare /serve/<id> path that may 404.
      const activeNoUrl: AppListing = {
        id: 'wallart',
        name: 'WallArt Canvas Pro',
        tagline: 'Interactive Canvas Split',
        description: 'Deployed wall art app',
        author: 'nate',
        authorAvatar: '🖼️',
        version: 'v1.0.0',
        upvotes: 0,
        forkCount: 0,
        tags: ['Wall Art'],
        screenshots: [],
        comments: [],
        deploymentState: 'active',
        activeDeploymentId: 'drev_wallart_prod_001',
        activeCommitOid: 'abcdef1234567890'
      };

      const html = renderToString(<EphemeralLiveApp app={activeNoUrl} />);
      expect(html).not.toContain('src="/serve/wallart/index.html"');
      expect(html).not.toContain('<iframe');
    });

    it('honors custom liveUrl for active verified deployments', () => {
      const customLiveApp: AppListing = {
        id: 'custom-app',
        name: 'Custom App',
        tagline: 'Custom Deployed App',
        description: 'Deployed app with custom URL',
        author: 'nate',
        authorAvatar: '⚡',
        version: 'v1.0.0',
        upvotes: 10,
        forkCount: 2,
        tags: ['App'],
        screenshots: [],
        comments: [],
        deploymentState: 'active',
        activeDeploymentId: 'drev_custom_prod_001',
        liveUrl: 'https://custom-app.example.com/app'
      };

      const html = renderToString(<EphemeralLiveApp app={customLiveApp} />);

      expect(html).toContain('ACTIVE (VERIFIED DEPLOYMENT)');
      expect(html).toContain('src="https://custom-app.example.com/app"');
    });
  });

  describe('Catalog Integrity & Standalone Route Resolution', () => {
    // (The former "INITIAL_APPS fixture has honest draft state" test was removed with
    // the fabricated INITIAL_APPS fixture itself — the catalog is now D1-sourced, and
    // the honest draft-state RENDERING is already covered above via EphemeralLiveApp.)
    it('resolves standalone app route for demo apps', () => {
      const routeWa = resolveAppRoute('', '', '', 'wallart');
      expect(routeWa.type).toBe('standalone_app');
      expect(routeWa.id).toBe('wallart');
      expect(routeWa.title).toBe('WallArt Canvas Pro');

      const routeCm = resolveAppRoute('', '', '', 'certified-mailer');
      expect(routeCm.type).toBe('standalone_app');
      expect(routeCm.id).toBe('certified-mailer');
      expect(routeCm.title).toBe('Certified Mailer');

      const routeDh = resolveAppRoute('', '', '', 'dronehunter');
      expect(routeDh.type).toBe('standalone_app');
      expect(routeDh.id).toBe('dronehunter');
      expect(routeDh.title).toBe('DroneHunter 95');
    });
  });
});

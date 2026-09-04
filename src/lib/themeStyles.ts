export type ThemeId = 'teal' | 'matrix' | 'sunset' | 'navy';

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  vars: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  teal: {
    id: 'teal',
    label: 'Teal 95',
    vars: {
      '--nsw-desktop-bg': '#008080',
      '--nsw-chrome-bg': '#c0c0c0',
      '--nsw-chrome-panel': '#ece9d8',
      '--nsw-chrome-text': '#000000',
      '--nsw-titlebar-bg': '#000080',
      '--nsw-titlebar-bg-end': '#1084d0',
      '--nsw-titlebar-text': '#ffffff',
      '--nsw-titlebar-inactive-bg': '#808080',
      '--nsw-titlebar-inactive-bg-end': '#a0a0a0',
      '--nsw-titlebar-inactive-text': '#d4d0c8',
      '--nsw-taskbar-bg': '#c0c0c0',
      '--nsw-taskbar-text': '#000000',
      '--nsw-taskbar-tab-active-bg': '#dfdfdf',
      '--nsw-taskbar-tab-inactive-bg': '#c0c0c0',
      '--nsw-menu-bg': '#c0c0c0',
      '--nsw-menu-text': '#000000',
      '--nsw-menu-hover-bg': '#000080',
      '--nsw-menu-hover-text': '#ffffff',
      '--nsw-btn-bg': '#c0c0c0',
      '--nsw-btn-text': '#000000',
      '--nsw-btn-primary-bg': '#000080',
      '--nsw-btn-primary-text': '#ffffff',
      '--nsw-field-bg': '#ffffff',
      '--nsw-field-text': '#000000',
      '--nsw-border-light': '#ffffff',
      '--nsw-border-dark': '#404040',
      '--nsw-border-shadow': '#808080'
    }
  },
  matrix: {
    id: 'matrix',
    label: 'Matrix',
    vars: {
      '--nsw-desktop-bg': '#0a140a',
      '--nsw-chrome-bg': '#102410',
      '--nsw-chrome-panel': '#081408',
      '--nsw-chrome-text': '#35d15b',
      '--nsw-titlebar-bg': '#004010',
      '--nsw-titlebar-bg-end': '#006622',
      '--nsw-titlebar-text': '#a0ffa0',
      '--nsw-titlebar-inactive-bg': '#0a1f0a',
      '--nsw-titlebar-inactive-bg-end': '#143314',
      '--nsw-titlebar-inactive-text': '#408040',
      '--nsw-taskbar-bg': '#102410',
      '--nsw-taskbar-text': '#35d15b',
      '--nsw-taskbar-tab-active-bg': '#1a381a',
      '--nsw-taskbar-tab-inactive-bg': '#102410',
      '--nsw-menu-bg': '#102410',
      '--nsw-menu-text': '#35d15b',
      '--nsw-menu-hover-bg': '#006622',
      '--nsw-menu-hover-text': '#ffffff',
      '--nsw-btn-bg': '#102410',
      '--nsw-btn-text': '#35d15b',
      '--nsw-btn-primary-bg': '#006622',
      '--nsw-btn-primary-text': '#ffffff',
      '--nsw-field-bg': '#050e05',
      '--nsw-field-text': '#35d15b',
      '--nsw-border-light': '#255225',
      '--nsw-border-dark': '#040a04',
      '--nsw-border-shadow': '#0f2b0f'
    }
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset',
    vars: {
      '--nsw-desktop-bg': '#1a102f',
      '--nsw-chrome-bg': '#2e1b4d',
      '--nsw-chrome-panel': '#22133a',
      '--nsw-chrome-text': '#f3e8ff',
      '--nsw-titlebar-bg': '#7c1d6f',
      '--nsw-titlebar-bg-end': '#c2410c',
      '--nsw-titlebar-text': '#ffffff',
      '--nsw-titlebar-inactive-bg': '#3b1d54',
      '--nsw-titlebar-inactive-bg-end': '#4c2866',
      '--nsw-titlebar-inactive-text': '#a78bfa',
      '--nsw-taskbar-bg': '#2e1b4d',
      '--nsw-taskbar-text': '#f3e8ff',
      '--nsw-taskbar-tab-active-bg': '#432470',
      '--nsw-taskbar-tab-inactive-bg': '#2e1b4d',
      '--nsw-menu-bg': '#2e1b4d',
      '--nsw-menu-text': '#f3e8ff',
      '--nsw-menu-hover-bg': '#7c1d6f',
      '--nsw-menu-hover-text': '#ffffff',
      '--nsw-btn-bg': '#2e1b4d',
      '--nsw-btn-text': '#f3e8ff',
      '--nsw-btn-primary-bg': '#c2410c',
      '--nsw-btn-primary-text': '#ffffff',
      '--nsw-field-bg': '#180b28',
      '--nsw-field-text': '#f3e8ff',
      '--nsw-border-light': '#633994',
      '--nsw-border-dark': '#120921',
      '--nsw-border-shadow': '#3b1d54'
    }
  },
  navy: {
    id: 'navy',
    label: 'DOS Navy',
    vars: {
      '--nsw-desktop-bg': '#000033',
      '--nsw-chrome-bg': '#000066',
      '--nsw-chrome-panel': '#000044',
      '--nsw-chrome-text': '#ffffff',
      '--nsw-titlebar-bg': '#0000aa',
      '--nsw-titlebar-bg-end': '#0055ff',
      '--nsw-titlebar-text': '#ffffff',
      '--nsw-titlebar-inactive-bg': '#000055',
      '--nsw-titlebar-inactive-bg-end': '#000077',
      '--nsw-titlebar-inactive-text': '#8888cc',
      '--nsw-taskbar-bg': '#000066',
      '--nsw-taskbar-text': '#ffffff',
      '--nsw-taskbar-tab-active-bg': '#0000aa',
      '--nsw-taskbar-tab-inactive-bg': '#000066',
      '--nsw-menu-bg': '#000066',
      '--nsw-menu-text': '#ffffff',
      '--nsw-menu-hover-bg': '#0055ff',
      '--nsw-menu-hover-text': '#ffffff',
      '--nsw-btn-bg': '#000066',
      '--nsw-btn-text': '#ffffff',
      '--nsw-btn-primary-bg': '#0055ff',
      '--nsw-btn-primary-text': '#ffffff',
      '--nsw-field-bg': '#000022',
      '--nsw-field-text': '#ffffff',
      '--nsw-border-light': '#0033cc',
      '--nsw-border-dark': '#000022',
      '--nsw-border-shadow': '#000055'
    }
  }
};

export function getThemeStyles(theme: ThemeId): React.CSSProperties {
  const definition = THEMES[theme] || THEMES.teal;
  return definition.vars as React.CSSProperties;
}

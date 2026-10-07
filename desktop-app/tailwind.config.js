/** @type {import('tailwindcss').Config} */

const defaultTheme = require('tailwindcss/defaultTheme');
const colors = require('tailwindcss/colors');
const typography = require('@tailwindcss/typography');

module.exports = {
  content: ['./src/renderer/**/*.tsx'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Legacy palette — remove once the dark: variants are fully collapsed.
        dark: {
          normal: colors.gray['300'],
        },
        light: {
          normal: colors.gray['700'],
        },
        // Hybrid Studio semantic tokens (values live in App.css per theme).
        bg: 'var(--bg)',
        dot: 'var(--dot)',
        panel: 'var(--panel)',
        card: 'var(--card)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        input: 'var(--input)',
        hover: 'var(--hover)',
        active: 'var(--active)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'on-accent': 'var(--on-accent)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        'control-off': 'var(--control-off)',
        overlay: '#ec4899',
        'overlay-soft': 'rgba(236,72,153,.12)',
        heart: 'var(--heart)',
        'heart-soft': 'var(--heart-soft)',
        'on-heart': 'var(--on-heart)',
        titlebar: 'var(--titlebar)',
        'titlebar-fg': 'var(--titlebar-fg)',
      },
      boxShadow: {
        elevated: 'var(--shadow)',
      },
      // Scales for new UI (older components move over as they are touched).
      fontSize: {
        caption: ['11px', '1.4'],
        small: ['12px', '1.45'],
        body: ['13px', '1.45'],
        title: ['15px', '1.3'],
        heading: ['18px', '1.25'],
      },
      borderRadius: {
        control: '7px',
        card: '10px',
        dialog: '12px',
      },
      height: {
        'control-sm': '24px',
        control: '30px',
        'control-lg': '36px',
      },
      fontFamily: {
        sans: ['Lato', ...defaultTheme.fontFamily.sans],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
      maxHeight: (theme) => ({
        ...theme('spacing'),
      }),
      maxWidth: (theme) => ({
        ...theme('spacing'),
      }),
      minHeight: (theme) => ({
        ...theme('spacing'),
      }),
      minWidth: (theme) => ({
        ...theme('spacing'),
      }),
    },
  },
  plugins: [typography],
};

import base from './playwright.config';

export default {
  ...base,
  projects: (base.projects ?? []).filter((project) => project.name === 'kefi-door-comp-sighting'),
};

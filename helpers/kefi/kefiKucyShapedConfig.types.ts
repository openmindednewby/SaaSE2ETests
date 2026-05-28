/**
 * DTO interfaces mirroring `Kefi.UseCases.Public.DTOs.LandingConfigDto` and
 * wrappers, used by the KUCY-shaped fixture builder
 * ({@link import('./kefiKucyShapedConfig').buildKucyShapedConfig}). Camel-cased
 * to match ASP.NET's default JSON contract — the server deserializes the wire
 * payload back into the C# DTOs by name.
 *
 * Pulled out of the main fixture file to keep both modules below the 300-line
 * file-size lint threshold.
 */

export interface SavedLandingDto {
  template: string;
  config: LandingConfigDto;
}

export interface LandingConfigDto {
  branding: LandingBranding;
  eventDetails: LandingEventDetails;
  venue: LandingVenue;
  register: LandingCallToAction;
  sections: LandingSection[];
  performerGroups: LandingPerformerGroup[];
  schedule: LandingSchedule;
  party: LandingParty;
  socialLinks: LandingSocialLink[];
}

export interface LandingBranding {
  name: string;
  tagline: string;
  edition: string;
  heroImageUrl: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  backgroundColors: string[];
}

export interface LandingEventDetails {
  dateLabel: string;
  classesTime: string;
  partyTime: string;
  locationLabel: string;
  eyebrow: string;
  heading: string;
  description: string;
  stats: LandingStat[];
}

export interface LandingStat {
  value: string;
  label: string;
}

export interface LandingVenue {
  name: string;
  city: string;
  address: string;
  mapUrl: string;
}

export interface LandingCallToAction {
  label: string;
  url: string;
  note: string;
}

export interface LandingSection {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
}

export interface LandingPerformerGroup {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  performers: LandingPerformer[];
}

export interface LandingPerformer {
  id: string;
  name: string;
  topic?: string;
  role?: string;
  room?: string;
  level?: string;
  photoUrl: string;
  instagramHandle?: string;
  instagramUrl?: string;
}

export interface LandingSchedule {
  eyebrow: string;
  title: string;
  subtitle: string;
  slots: LandingScheduleSlot[];
}

export interface LandingScheduleSlot {
  id: string;
  time: string;
  classes: LandingScheduleClass[];
}

export interface LandingScheduleClass {
  teacher: string;
  topic: string;
  room: string;
  level: string;
}

export interface LandingParty {
  eyebrow: string;
  title: string;
  subtitle: string;
  rooms: LandingPartyRoom[];
}

export interface LandingPartyRoom {
  id: string;
  name: string;
  music: string;
  dj: string;
}

export interface LandingSocialLink {
  id: string;
  kind: string;
  label: string;
  url: string;
}

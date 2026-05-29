/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, Calendar, Clock, MapPin, Video, Users, Loader2, RefreshCw,
  ExternalLink, Plus, Sparkles
} from 'lucide-react';
import { calendarService } from '../services/calendar-service';
import { outlookService } from '../services/outlook-service';
import type { CalendarEvent } from '../services/calendar-service';
import type { OutlookEvent } from '../services/outlook-service';

interface CalendarViewProps {
  source: 'google' | 'outlook' | 'all';
  onClose: () => void;
}

type UnifiedEvent = {
  id: string;
  source: 'google' | 'outlook';
  title: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  organizer?: string;
  attendees?: Array<{ email: string; name: string; status?: string }>;
  isOnlineMeeting?: boolean;
  meetingUrl?: string;
  link?: string;
};

export const CalendarView: React.FC<CalendarViewProps> = ({ source, onClose }) => {
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createTarget, setCreateTarget] = useState<'google' | 'outlook'>('google');
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    start: '',
    end: '',
    location: '',
    attendees: ''
  });
  const [creating, setCreating] = useState(false);

  const sourceLabel = source === 'all' ? 'All Calendars' : source === 'google' ? 'Google Calendar' : 'Outlook Calendar';

  const normalizeGoogle = (event: CalendarEvent): UnifiedEvent => ({
    id: `google_${event.id}`,
    source: 'google',
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    link: event.link
  });

  const normalizeOutlook = (event: OutlookEvent): UnifiedEvent => ({
    id: `outlook_${event.id}`,
    source: 'outlook',
    title: event.subject,
    description: event.bodyPreview,
    start: event.start,
    end: event.end,
    location: event.location,
    organizer: event.organizer,
    attendees: event.attendees,
    isOnlineMeeting: event.isOnlineMeeting,
    meetingUrl: event.onlineMeetingUrl,
    link: event.webLink
  });

  const loadEvents = async () => {
    setLoading(true);
    const allEvents: UnifiedEvent[] = [];

    try {
      if (source === 'google' || source === 'all') {
        const googleEvents = await calendarService.getUpcomingEvents(20);
        allEvents.push(...googleEvents.map(normalizeGoogle));
      }
      if (source === 'outlook' || source === 'all') {
        const outlookEvents = await outlookService.getCalendarEvents(20);
        allEvents.push(...outlookEvents.map(normalizeOutlook));
      }

      // Sort by start time
      allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      setEvents(allEvents);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEvents(); }, [source]);

  const handleCreate = async () => {
    if (!newEvent.title || !newEvent.start || !newEvent.end) {
      alert('Title, start time, and end time are required');
      return;
    }

    setCreating(true);
    try {
      const startISO = new Date(newEvent.start).toISOString();
      const endISO = new Date(newEvent.end).toISOString();
      const attendeesList = newEvent.attendees
        ? newEvent.attendees.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      let result;
      if (createTarget === 'google') {
        // Google Calendar uses calendarService.syncReminder which converts a reminder
        // For a proper event creation we'll use the same syncReminder structure
        result = await calendarService.syncReminder({
          id: `manual_${Date.now()}`,
          title: newEvent.title,
          description: newEvent.description,
          dueDate: startISO
        });
      } else {
        result = await outlookService.createCalendarEvent({
          subject: newEvent.title,
          body: newEvent.description,
          start: startISO,
          end: endISO,
          location: newEvent.location || undefined,
          attendees: attendeesList.length > 0 ? attendeesList : undefined
        });
      }

      if (result.success) {
        setShowCreate(false);
        setNewEvent({ title: '', description: '', start: '', end: '', location: '', attendees: '' });
        loadEvents();
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  const formatEventTime = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const isSameDay = s.toDateString() === e.toDateString();

    const dateStr = s.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    const startTime = s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSameDay) return { date: dateStr, time: `${startTime} - ${endTime}` };
    return {
      date: `${dateStr} - ${e.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      time: `${startTime} - ${endTime}`
    };
  };

  const groupEventsByDate = (events: UnifiedEvent[]) => {
    const groups: Record<string, UnifiedEvent[]> = {};
    events.forEach(event => {
      const dateKey = new Date(event.start).toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });
    return groups;
  };

  const isToday = (date: string) => new Date(date).toDateString() === new Date().toDateString();
  const isTomorrow = (date: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Date(date).toDateString() === tomorrow.toDateString();
  };

  const groupedEvents = groupEventsByDate(events);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-4xl h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-pink-500/20">
              <Calendar className="w-5 h-5 text-pink-500" />
            </div>
            <div>
              <h3 className="text-lg font-bold">{sourceLabel}</h3>
              <p className="text-xs text-gray-500">
                {loading ? 'Loading...' : `${events.length} upcoming events`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRefreshing(true); loadEvents().finally(() => setRefreshing(false)); }}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-3 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> New Event
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Events */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-center px-4">
              <Calendar className="w-12 h-12 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500 mb-1">No upcoming events</p>
              <p className="text-xs text-gray-600">Click "New Event" to create one</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {Object.entries(groupedEvents).map(([dateKey, dayEvents]) => {
                const firstEvent = dayEvents[0];
                const dateLabel = isToday(firstEvent.start) ? 'Today'
                  : isTomorrow(firstEvent.start) ? 'Tomorrow'
                  : dateKey;

                return (
                  <div key={dateKey} className="p-4">
                    <h4 className={`text-xs font-bold uppercase tracking-widest mb-3 ${
                      isToday(firstEvent.start) ? 'text-pink-500' : 'text-gray-500'
                    }`}>
                      {dateLabel}
                    </h4>
                    <div className="space-y-2">
                      {dayEvents.map(event => {
                        const { time } = formatEventTime(event.start, event.end);
                        const sourceColor = event.source === 'google' ? '#4285F4' : '#0078D4';

                        return (
                          <div
                            key={event.id}
                            className="bg-white/5 hover:bg-white/[0.07] border border-white/10 p-4 rounded-2xl transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex items-start gap-3 flex-1">
                                <div className="w-1 h-12 rounded-full flex-shrink-0" style={{ backgroundColor: sourceColor }} />
                                <div className="flex-1 min-w-0">
                                  <h5 className="text-sm font-bold text-white truncate">{event.title}</h5>
                                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> {time}
                                    </span>
                                    {event.location && (
                                      <span className="flex items-center gap-1 truncate">
                                        <MapPin className="w-3 h-3 flex-shrink-0" /> {event.location}
                                      </span>
                                    )}
                                    {event.isOnlineMeeting && (
                                      <span className="flex items-center gap-1 text-blue-400">
                                        <Video className="w-3 h-3" /> Online
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span
                                className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
                                style={{ backgroundColor: `${sourceColor}20`, color: sourceColor }}
                              >
                                {event.source}
                              </span>
                            </div>

                            {event.description && (
                              <p className="text-xs text-gray-500 line-clamp-2 ml-4 mt-2">
                                {event.description}
                              </p>
                            )}

                            {event.attendees && event.attendees.length > 0 && (
                              <div className="flex items-center gap-2 mt-3 ml-4">
                                <Users className="w-3 h-3 text-gray-500" />
                                <div className="flex -space-x-2">
                                  {event.attendees.slice(0, 4).map((a, i) => (
                                    <div
                                      key={i}
                                      className="w-5 h-5 rounded-full bg-gradient-to-br from-pink-500/30 to-blue-500/30 border border-black flex items-center justify-center text-[8px] font-bold"
                                      title={a.name || a.email}
                                    >
                                      {(a.name || a.email).charAt(0).toUpperCase()}
                                    </div>
                                  ))}
                                  {event.attendees.length > 4 && (
                                    <div className="w-5 h-5 rounded-full bg-white/10 border border-black flex items-center justify-center text-[8px] font-bold">
                                      +{event.attendees.length - 4}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-2 mt-3 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                              {event.meetingUrl && (
                                <a
                                  href={event.meetingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  <Video className="w-3 h-3" /> Join meeting
                                </a>
                              )}
                              {event.link && (
                                <a
                                  href={event.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" /> Open
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Event Modal */}
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <h3 className="text-lg font-bold">New Calendar Event</h3>
                <button onClick={() => setShowCreate(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                    Calendar
                  </label>
                  <div className="flex gap-2">
                    {source !== 'outlook' && (
                      <button
                        onClick={() => setCreateTarget('google')}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                          createTarget === 'google' ? 'bg-blue-500 text-white' : 'bg-white/5 text-gray-400 border border-white/10'
                        }`}
                      >
                        Google Calendar
                      </button>
                    )}
                    {source !== 'google' && (
                      <button
                        onClick={() => setCreateTarget('outlook')}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                          createTarget === 'outlook' ? 'bg-blue-700 text-white' : 'bg-white/5 text-gray-400 border border-white/10'
                        }`}
                      >
                        Outlook Calendar
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                    Title*
                  </label>
                  <input
                    type="text"
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                    placeholder="Event title"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-pink-500/50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                      Start*
                    </label>
                    <input
                      type="datetime-local"
                      value={newEvent.start}
                      onChange={(e) => setNewEvent({ ...newEvent, start: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-pink-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                      End*
                    </label>
                    <input
                      type="datetime-local"
                      value={newEvent.end}
                      onChange={(e) => setNewEvent({ ...newEvent, end: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-pink-500/50"
                    />
                  </div>
                </div>

                {createTarget === 'outlook' && (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                        Location
                      </label>
                      <input
                        type="text"
                        value={newEvent.location}
                        onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                        placeholder="Optional"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-pink-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                        Attendees (comma separated)
                      </label>
                      <input
                        type="text"
                        value={newEvent.attendees}
                        onChange={(e) => setNewEvent({ ...newEvent, attendees: e.target.value })}
                        placeholder="email1@example.com, email2@example.com"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-pink-500/50"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">
                    Description
                  </label>
                  <textarea
                    value={newEvent.description}
                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                    placeholder="Optional"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-pink-500/50 resize-none h-20"
                  />
                </div>
              </div>
              <div className="p-4 bg-white/[0.02] border-t border-white/10 flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-5 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {creating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                  ) : (
                    <><Plus className="w-4 h-4" /> Create Event</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
};

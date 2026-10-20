import { beforeEach, describe, expect, it } from 'vitest';
import { addNotification, MAX_NOTIFICATIONS, useNotifications } from './notifications';

describe('notification centre', () => {
  beforeEach(() => useNotifications.getState().clearAll());

  it('groups identical notifications instead of flooding the list', () => {
    let list = addNotification([], { severity: 'error', title: 'Share failed' }, 't1', 'a').list;
    list = addNotification(list, { severity: 'info', title: 'Other' }, 't2', 'b').list;
    const { list: grouped, notification } = addNotification(
      list,
      { severity: 'error', title: 'Share failed' },
      't3',
      'c',
    );
    expect(grouped).toHaveLength(2);
    expect(notification).toMatchObject({ id: 'a', count: 2, updatedAt: 't3', read: false });
    expect(grouped[0]!.id).toBe('a');
  });

  it('keeps notifications about different objects apart', () => {
    let list = addNotification(
      [],
      { severity: 'warning', title: 'Not routed', target: { lineId: 'l1' } },
      't',
      'a',
    ).list;
    list = addNotification(
      list,
      { severity: 'warning', title: 'Not routed', target: { lineId: 'l2' } },
      't',
      'b',
    ).list;
    expect(list).toHaveLength(2);
  });

  it('caps the list', () => {
    let list: ReturnType<typeof addNotification>['list'] = [];
    for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++)
      list = addNotification(list, { severity: 'info', title: `n${i}` }, 't').list;
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list[0]!.title).toBe(`n${MAX_NOTIFICATIONS + 4}`);
  });

  it('records toasts, tracks unread state, dismisses and clears', () => {
    const s = useNotifications.getState();
    const a = s.notify({ severity: 'error', title: 'A' });
    s.notify({ severity: 'success', title: 'B', toast: false });
    expect(useNotifications.getState().toast?.id).toBe(a.id);
    expect(useNotifications.getState().items.filter((n) => !n.read)).toHaveLength(2);
    s.markRead(a.id);
    expect(useNotifications.getState().items.find((n) => n.id === a.id)!.read).toBe(true);
    s.dismiss(a.id);
    expect(useNotifications.getState().toast).toBeNull();
    expect(useNotifications.getState().items).toHaveLength(1);
    s.notify({ severity: 'info', title: 'transient', record: false });
    expect(useNotifications.getState().items).toHaveLength(1);
    s.clearAll();
    expect(useNotifications.getState().items).toEqual([]);
  });
});

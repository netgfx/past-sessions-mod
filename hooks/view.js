// past-sessions: draws the pane from a plain model; every press goes back
// through `act`, so this file never touches $

import { archivedSessions, COLLAPSED_COUNT, fit, formatSize, longDate, shortAge, visibleSessions } from './lib.js'

const AGE_COLUMNS = 6

export function renderPane(E, m, act) {
  const { Box, Text, Button } = E
  const width = Math.max(20, m.width)
  const children = []

  const list = visibleSessions(m.sessions, {
    pins: m.pins,
    archived: m.archived,
    expanded: m.expanded,
    count: COLLAPSED_COUNT,
  })
  const archivedList = archivedSessions(m.sessions, m.archived)
  // Only the rows on screen count: collapsed, the hidden ones are never read
  const onScreen = [...list.pinned, ...list.others, ...(m.showArchived ? archivedList : [])]
  const pending = onScreen.filter((s) => !s.summary).length

  children.push(
    Box({
      key: 'head',
      flexDirection: 'row',
      justifyContent: 'space-between',
      width,
      children: [
        Text({
          bold: true,
          children: ['Past sessions' + (list.total ? ' · ' + list.total : '')],
        }),
        Button({ key: 'refresh', label: m.scanning || pending ? 'loading…' : 'refresh', plain: true, dimColor: true, onPress: act.refresh }),
      ],
    }),
  )

  if (m.problem) {
    children.push(Text({ color: 'yellow', wrap: 'wrap', children: [m.problem] }))
    return Box({ flexDirection: 'column', children })
  }
  if (m.status) children.push(Text({ dimColor: true, wrap: 'wrap', children: [m.status] }))

  if (list.total === 0 && !pending) {
    children.push(Text({ dimColor: true, wrap: 'wrap', children: ['No other sessions in this project yet.'] }))
  }

  if (list.pinned.length) {
    children.push(sectionLabel(Text, 'Pinned'))
    for (const s of list.pinned) children.push(...row(E, m, act, s, width))
  }
  if (list.others.length) {
    if (list.pinned.length) children.push(sectionLabel(Text, 'Recent'))
    for (const s of list.others) children.push(...row(E, m, act, s, width))
  }

  const footer = []
  if (list.hidden > 0) {
    footer.push(Button({ key: 'more', label: 'More… (' + list.hidden + ')', hotkey: 'm', plain: true, onPress: act.toggleMore }))
  } else if (m.expanded && list.others.length > COLLAPSED_COUNT) {
    footer.push(Button({ key: 'less', label: 'Less…', hotkey: 'm', plain: true, onPress: act.toggleMore }))
  }
  if (archivedList.length) {
    footer.push(
      Button({
        key: 'archived',
        label: (m.showArchived ? 'Hide archived' : 'Archived') + ' (' + archivedList.length + ')',
        hotkey: 'h',
        plain: true,
        dimColor: true,
        onPress: act.toggleArchived,
      }),
    )
  }
  if (footer.length) children.push(Box({ key: 'footer', flexDirection: 'row', columnGap: 3, marginTop: 1, children: footer }))

  if (m.showArchived && archivedList.length) {
    children.push(sectionLabel(Text, 'Archived'))
    for (const s of archivedList) children.push(...row(E, m, act, s, width))
  }

  return Box({ flexDirection: 'column', children })
}

function sectionLabel(Text, label) {
  return Text({ dimColor: true, children: [label] })
}

// One session's line, and under it its details when it is the selected one
function row(E, m, act, s, width) {
  const { Box, Text, Button } = E
  const isSelected = m.selected === s.id
  const isArchived = m.archived.has(s.id)
  const title = s.summary ? s.summary.title || '(untitled)' : 'loading…'
  const label = (isSelected ? '> ' : '  ') + fit(title, width - AGE_COLUMNS - 3)
  const out = [
    Box({
      key: 'line-' + s.id,
      flexDirection: 'row',
      justifyContent: 'space-between',
      width,
      children: [
        Button({
          key: 'row-' + s.id,
          label,
          plain: true,
          ...(isArchived || !s.summary ? { dimColor: true } : {}),
          onPress: () => act.select(s.id),
        }),
        Text({ dimColor: true, children: [shortAge(s.mtimeMs, m.now).padStart(AGE_COLUMNS)] }),
      ],
    }),
  ]
  if (isSelected) out.push(details(E, m, act, s, width))
  return out
}

function details(E, m, act, s, width) {
  const { Box, Text, Button } = E
  const sum = s.summary
  const inner = width - 4
  const lines = []
  if (!sum) {
    lines.push(Text({ dimColor: true, children: ['Reading the transcript…'] }))
  } else {
    // The whole title, when the row above had to cut it
    if (sum.title && sum.title.length > width - AGE_COLUMNS - 5) {
      lines.push(Text({ bold: true, wrap: 'wrap', children: [sum.title] }))
    }
    lines.push(Text({ dimColor: true, children: ['Task'] }))
    lines.push(Text({ wrap: 'wrap', children: [sum.firstPrompt || '(no prompt)'] }))
    if (sum.lastPrompt && sum.lastPrompt !== sum.firstPrompt) {
      lines.push(Text({ dimColor: true, children: ['Last request'] }))
      lines.push(Text({ wrap: 'wrap', children: [sum.lastPrompt] }))
    }
    const facts = [
      'Started ' + longDate(sum.startedAt),
      'Last active ' + longDate(s.mtimeMs),
      [plural(sum.prompts, 'prompt') + (sum.isPartial ? '+' : ''), sum.branch ? 'branch ' + sum.branch : '', formatSize(s.size)]
        .filter(Boolean)
        .join(' · '),
    ]
    for (const f of facts) lines.push(Text({ dimColor: true, wrap: 'wrap', children: [fit(f, inner)] }))
  }
  lines.push(Text({ dimColor: true, children: [fit(s.id, inner)] }))

  const isPinned = m.pins.has(s.id)
  const isArchived = m.archived.has(s.id)
  const buttons = [
    Button({ key: 'resume', label: 'r: Resume', hotkey: 'r', variant: 'primary', autoFocus: true, onPress: () => act.resume(s.id) }),
  ]
  if (!isArchived) {
    buttons.push(Button({ key: 'pin', label: isPinned ? 'p: Unpin' : 'p: Pin', hotkey: 'p', onPress: () => act.pin(s.id) }))
  }
  buttons.push(Button({ key: 'archive', label: isArchived ? 'a: Unarchive' : 'a: Archive', hotkey: 'a', onPress: () => act.archive(s.id) }))
  buttons.push(Button({ key: 'copy', label: 'c: Copy', hotkey: 'c', dimColor: true, onPress: (e) => act.copy(s.id, e) }))

  return Box({
    key: 'details-' + s.id,
    flexDirection: 'column',
    paddingLeft: 2,
    marginBottom: 1,
    children: [...lines, Box({ key: 'actions-' + s.id, flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children: buttons })],
  })
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}

// Finds the newest release on GitHub and points the download buttons at the right installer for this computer.
// Without JavaScript, or if GitHub can't be reached, the links fall back to the download page and the releases page.
;(function () {
  var REPO = 'cameronjtoy/Prem'
  var RELEASES = 'https://github.com/' + REPO + '/releases'

  var INSTALLERS = [
    { os: 'mac', label: 'macOS, Apple silicon', match: /-mac-arm64\.dmg$/ },
    { os: 'mac', label: 'macOS, Intel', match: /-mac-x64\.dmg$/ },
    { os: 'windows', label: 'Windows 10 and 11', match: /-win-x64\.exe$/ },
    { os: 'linux', label: 'Linux, AppImage', match: /-linux-x86_64\.AppImage$/ },
    { os: 'linux', label: 'Debian and Ubuntu, .deb', match: /-linux-amd64\.deb$/ },
    { os: 'server', label: 'Lab server for Node.js', match: /^prem-server-.*\.js$/ },
    { os: 'checksums', label: 'SHA-256 checksums', match: /^SHA256SUMS\.txt$/ }
  ]

  function detectOs() {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
    var ua = navigator.userAgent
    if (/mac/i.test(platform) || /Macintosh/.test(ua)) return /iPhone|iPad/.test(ua) ? null : 'mac'
    if (/win/i.test(platform) || /Windows/.test(ua)) return 'windows'
    if (/linux/i.test(platform) && !/Android/.test(ua)) return 'linux'
    return null
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag)
    for (var key in attrs) node.setAttribute(key, attrs[key])
    if (text) node.textContent = text
    return node
  }

  function formatSize(bytes) {
    return bytes > 1e6 ? Math.round(bytes / 1e6) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB'
  }

  function latestRelease() {
    // /releases (not /releases/latest) so pilot pre-releases are offered while there's no full release yet.
    return fetch('https://api.github.com/repos/' + REPO + '/releases?per_page=10')
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub answered ' + res.status)
        return res.json()
      })
      .then(function (releases) {
        var published = releases.filter(function (r) {
          return !r.draft
        })
        return (
          published.find(function (r) {
            return !r.prerelease
          }) ||
          published[0] ||
          null
        )
      })
  }

  function installersOf(release) {
    var found = []
    INSTALLERS.forEach(function (kind) {
      var asset = release.assets.find(function (a) {
        return kind.match.test(a.name)
      })
      if (asset) found.push({ kind: kind, asset: asset })
    })
    return found
  }

  function renderReleaseBox(box, release, os) {
    box.textContent = ''
    if (!release) {
      box.appendChild(
        el('p', {}, 'There is no release yet. Prem is preparing for its first pilot; until then, run it from source.')
      )
      return
    }
    var files = installersOf(release)
    var heading = el('p', { class: 'release-name' })
    heading.appendChild(el('strong', {}, release.name || release.tag_name))
    if (release.prerelease) heading.appendChild(el('span', { class: 'badge' }, 'Pre-release'))
    heading.appendChild(
      el(
        'span',
        { class: 'muted' },
        ' · ' + new Date(release.published_at).toLocaleDateString(undefined, { dateStyle: 'long' })
      )
    )
    box.appendChild(heading)

    var mine = files.filter(function (f) {
      return f.kind.os === os
    })
    if (mine.length) {
      var buttons = el('div', { class: 'actions' })
      mine.forEach(function (f, i) {
        buttons.appendChild(
          el(
            'a',
            { class: 'button' + (i === 0 ? ' primary' : ''), href: f.asset.browser_download_url },
            'Download for ' + f.kind.label
          )
        )
      })
      box.appendChild(buttons)
    }

    var table = el('table', { class: 'files' })
    files.forEach(function (f) {
      var row = el('tr')
      var name = el('td')
      name.appendChild(el('a', { href: f.asset.browser_download_url }, f.kind.label))
      row.appendChild(name)
      row.appendChild(el('td', { class: 'muted' }, f.asset.name))
      row.appendChild(el('td', { class: 'muted num' }, formatSize(f.asset.size)))
      table.appendChild(row)
    })
    box.appendChild(table)
    var more = el('p', { class: 'small' })
    more.appendChild(el('a', { href: release.html_url }, 'Release notes'))
    more.appendChild(document.createTextNode(' · '))
    more.appendChild(el('a', { href: RELEASES }, 'All releases'))
    box.appendChild(more)
  }

  function updateHeroButton(release, os) {
    var button = document.querySelector('[data-download]')
    var note = document.querySelector('[data-download-note]')
    if (!button || !release) return
    var mine = installersOf(release).filter(function (f) {
      return f.kind.os === os
    })
    if (!mine.length) return
    button.href = mine[0].asset.browser_download_url
    button.textContent = 'Download for ' + mine[0].kind.label
    if (note) {
      note.textContent = ''
      note.appendChild(document.createTextNode((release.name || release.tag_name) + '. '))
      note.appendChild(el('a', { href: 'download.html' }, 'Other platforms and the lab server'))
    }
  }

  var box = document.querySelector('[data-release]')
  var os = detectOs()
  latestRelease()
    .then(function (release) {
      if (box) renderReleaseBox(box, release, os)
      updateHeroButton(release, os)
    })
    .catch(function () {
      if (!box) return
      box.textContent = ''
      var p = el('p', {}, "Couldn't reach GitHub to find the latest release. ")
      p.appendChild(el('a', { href: RELEASES }, 'Open the releases page'))
      box.appendChild(p)
    })
})()

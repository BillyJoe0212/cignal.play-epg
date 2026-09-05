const fs = require('fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeId(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function generateEPG() {
  const now = new Date();
  const manilaOffset = 8 * 60 * 60 * 1000;
  const manilaNow = new Date(now.getTime() + manilaOffset);

// Anchor to the current hour in Manila Time so it shifts with every 6-hour run
  const startDay = new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate(), manilaNow.getUTCHours(), 0, 0) - manilaOffset);

  const DAYS_TO_FETCH = 6;
  let rawChannelEntries = [];

  for (let d = 0; d < DAYS_TO_FETCH; d++) {
    const chunkStartUtc = new Date(startDay.getTime() + d * 24 * 60 * 60 * 1000);
    const chunkEndUtc = new Date(startDay.getTime() + (d + 1) * 24 * 60 * 60 * 1000);

    const startStr = chunkStartUtc.toISOString().split('.')[0] + 'Z';
    const endStr = chunkEndUtc.toISOString().split('.')[0] + 'Z';

    console.log(`\n--- Fetching Day ${d + 1}/${DAYS_TO_FETCH} (${startStr} -> ${endStr}) ---`);

    // Ordered with QuickPlay/alternative endpoints first to bypass firstlight upstream outages
    const endpoints = [
      (p) => `https://data-store-cdn.api.pldtcms.quickplay.com/content/epg?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&reg=ph&dt=web&client=pldt-plive-console&pageNumber=${p}&pageSize=100`,
      (p) => `https://data-store-cdn.api.pldtcms.quickplay.com/content/epg?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=${p}&pageSize=100`,
      (p) => `https://data-store-cdn.api.pldtcms.quickplay.com/content/epg?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&reg=ph&dt=all&client=pldt-cignal-app&pageNumber=${p}&pageSize=100`,
      (p) => `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&reg=ph&dt=all&client=pldt-cignal-web&pageNumber=${p}&pageSize=100`,
      (p) => `https://data-store-cdn.api.pldt.firstlight.ai/content/epg?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}&reg=ph&dt=all&client=pldt-cignal-app&pageNumber=${p}&pageSize=100`
    ];

    for (const getUrl of endpoints) {
      let page = 1;
      let endpointFailed = false;
      
      while (page <= 20 && !endpointFailed) {
        try {
          const targetUrl = getUrl(page);
          const res = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Origin': 'https://cignalplay.com',
              'Referer': 'https://cignalplay.com/'
            }
          });

          if (!res.ok) {
            // If we hit gateway errors like 502/503/504 ("no healthy upstream"), break out of this endpoint loop cleanly
            if (res.status >= 500) {
              console.log(`Endpoint warning: Server returned ${res.status}. Switching to backup mirror.`);
            }
            break;
          }

          const json = await res.json();
          const pageData = json.data || [];
          if (!Array.isArray(pageData) || pageData.length === 0) break;

          rawChannelEntries = rawChannelEntries.concat(pageData);
          page++;
          await sleep(80);
        } catch (err) {
          // Network errors or DNS failures won't crash the entire action
          break;
        }
      }
    }
  }

  if (rawChannelEntries.length === 0) {
    console.error("FATAL: All endpoints failed or returned 0 entries. Aborting to protect existing cignal.xml.");
    process.exit(1);
  }

  const channelMap = new Map();
  const channelPrograms = new Map();

  const formatXmlTime = (dateStr) => {
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
  };

  const isGenericTBA = (title) => {
    const t = (title || '').trim().toLowerCase();
    return t === 'to be announced' || t === 'tba' || t === 'placeholder' || t === '';
  };

  rawChannelEntries.forEach(chItem => {
    const idSet = new Set();

    if (chItem.cs) idSet.add(chItem.cs);
    if (chItem.ex_id) idSet.add(chItem.ex_id);
    if (chItem.id) idSet.add(chItem.id);

    const firstAir = chItem.airing && chItem.airing[0];
    if (firstAir && firstAir.ch) {
      if (firstAir.ch.cs) idSet.add(firstAir.ch.cs);
      if (firstAir.ch.ex_id) idSet.add(firstAir.ch.ex_id);
      if (firstAir.ch.acs) idSet.add(firstAir.ch.acs);
      if (firstAir.ch.id) idSet.add(firstAir.ch.id);
    }

    if (firstAir && Array.isArray(firstAir.ep)) {
      firstAir.ep.forEach(e => {
        if (e && e.id) idSet.add(e.id);
      });
    }

    const chName = (chItem.lon && chItem.lon[0] && chItem.lon[0].n) ||
                   (firstAir && firstAir.ch && firstAir.ch.lon && firstAir.ch.lon[0] && firstAir.ch.lon[0].n) ||
                   Array.from(idSet)[0] || "Unknown Channel";

    if (chName && chName !== "Unknown Channel") {
      idSet.add(chName);
      idSet.add(normalizeId(chName));
      idSet.add(chName.replace(/\s+/g, '_'));
      idSet.add(chName.replace(/\s+/g, '-'));
    }

    idSet.forEach(id => {
      if (id) {
        if (!channelMap.has(id) || channelMap.get(id) === id) {
          channelMap.set(id, chName);
        }
        if (!channelPrograms.has(id)) {
          channelPrograms.set(id, []);
        }
      }
    });

    if (Array.isArray(chItem.airing)) {
      chItem.airing.forEach(air => {
        let title = (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) ||
                    (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) ||
                    (air.lon && air.lon[0] && air.lon[0].n) ||
                    (air.lod && air.lod[0] && air.lod[0].n) ||
                    "To Be Announced";

        let desc = (air.pgm && air.pgm.lod && air.pgm.lod[0] && air.pgm.lod[0].n) ||
                   (air.pgm && air.pgm.lon && air.pgm.lon[0] && air.pgm.lon[0].n) ||
                   (air.lod && air.lod[0] && air.lod[0].n) ||
                   (air.lon && air.lon[0] && air.lon[0].n) || "";

        const startTime = air.sc_st_dt;
        const endTime = air.sc_ed_dt;

        if (startTime && endTime) {
          const startEpoch = new Date(startTime).getTime();
          const endEpoch = new Date(endTime).getTime();
          const placeholder = isGenericTBA(title);

          idSet.forEach(targetId => {
            channelPrograms.get(targetId).push({
              chId: targetId,
              title: title.trim() || "To Be Announced",
              desc: desc.trim(),
              start: formatXmlTime(startTime),
              stop: formatXmlTime(endTime),
              startEpoch,
              endEpoch,
              isPlaceholder: placeholder
            });
          });
        }
      });
    }
  });

  const finalPrograms = [];

  channelPrograms.forEach((programs, chId) => {
    if (programs.length === 0) return;

    const realPrograms = programs.filter(p => !p.isPlaceholder);
    programs.sort((a, b) => a.startEpoch - b.startEpoch);

    const resolved = [];
    const seenTimes = new Set();

    programs.forEach(prog => {
      if (prog.isPlaceholder) {
        const hasSpecificTitleOverlap = realPrograms.some(r =>
          (prog.startEpoch < r.endEpoch && prog.endEpoch > r.startEpoch)
        );
        if (hasSpecificTitleOverlap) return;
      }

      const dedupeKey = `${prog.start}_${prog.stop}_${prog.title}`;
      if (!seenTimes.has(dedupeKey)) {
        seenTimes.add(dedupeKey);
        resolved.push(prog);
      }
    });

    finalPrograms.push(...resolved);
  });

  if (finalPrograms.length === 0) {
    console.error("FATAL: 0 programs resolved. Aborting.");
    process.exit(1);
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="GitHub Action Converter">\n`;

  channelMap.forEach((name, id) => {
    xml += `  <channel id="${escapeXml(id)}">\n    <display-name>${escapeXml(name)}</display-name>\n  </channel>\n`;
  });

  finalPrograms.forEach(p => {
    xml += `  <programme start="${p.start}" stop="${p.stop}" channel="${escapeXml(p.chId)}">\n`;
    xml += `    <title lang="en">${escapeXml(p.title)}</title>\n`;
    if (p.desc && p.desc.trim() !== "" && p.desc !== p.title) {
      xml += `    <desc lang="en">${escapeXml(p.desc)}</desc>\n`;
    }
    xml += `  </programme>\n`;
  });

  xml += `</tv>`;

  const timestampComment = `<!-- Last updated: ${new Date().toISOString()} -->\n`;
  fs.writeFileSync('cignal.xml', timestampComment + xml, 'utf-8');
  console.log(`\nSUCCESS: Generated cignal.xml with ${channelMap.size} channel identifiers and ${finalPrograms.length} total programs.`);
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString().replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

generateEPG();

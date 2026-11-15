const SPREADSHEET_ID = "1RVRrqUgoargLWD734oWVaGi2MPDOsPpWJ9D8YGS_6xk";
const REVISION_KEY = "stayboardRevision";

const TABLES = {
  Hotels: ["id", "name"],
  Rooms: ["id", "hotelId", "roomNumber", "isExtra", "availableFrom"],
  Stays: ["id", "headGuest", "guestCount", "otherGuests", "segmentsJson", "documentUrl", "documentId", "documentName"]
};

function initializeStayboard() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = ensureSheets_();
    const hasExistingData = Object.keys(TABLES).some(function (name) {
      return sheets[name].getLastRow() > 1;
    });
    if (hasExistingData) {
      throw new Error("Setup stopped: one or more Stayboard tabs already contain data. No data was changed.");
    }

    const hotels = [
      { id: "hotel-1", name: "Krati Resort" },
      { id: "hotel-2", name: "Jass Grand" },
      { id: "hotel-3", name: "Maantra" }
    ];
    const rooms = [];
    addRooms_(rooms, "hotel-1", 101, 110, "2026-11-20");
    addRooms_(rooms, "hotel-2", 101, 106, "2026-11-19");
    addRooms_(rooms, "hotel-2", 107, 114, "2026-11-20");
    addRooms_(rooms, "hotel-3", 101, 120, "2026-11-19");

    writeData_(sheets, { hotels: hotels, rooms: rooms, stays: [] });
    PropertiesService.getScriptProperties().setProperty(REVISION_KEY, "0");
    return "Stayboard tabs initialized with 3 hotels and 44 rooms.";
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Stayboard — Hotel tracker")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getStayboardData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return {
      ok: true,
      revision: getRevision_(),
      data: readData_()
    };
  } finally {
    lock.releaseLock();
  }
}

function saveStayboardData(request) {
  if (!request || request.action !== "save" || !request.data) {
    return { ok: false, error: "Expected action 'save' and a complete data object." };
  }

  const validationError = validateData_(request.data);
  if (validationError) return { ok: false, error: validationError };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const currentRevision = getRevision_();
    if (String(request.revision) !== currentRevision) {
      return {
        ok: false,
        error: "STALE_DATA",
        message: "The shared data changed since it was loaded. Reload before saving."
      };
    }

    const sheets = ensureSheets_();
    writeData_(sheets, request.data);
    const nextRevision = String(Number(currentRevision) + 1);
    PropertiesService.getScriptProperties().setProperty(REVISION_KEY, nextRevision);
    return { ok: true, revision: nextRevision };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error.message || "Could not save Stayboard data." };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function doPost(event) {
  let request;
  try {
    request = JSON.parse(event.postData.contents);
  } catch (error) {
    return jsonOutput_({ ok: false, error: "Request body must be valid JSON." });
  }
  return jsonOutput_(saveStayboardData(request));
}

function addRooms_(rooms, hotelId, first, last, availableFrom) {
  for (let number = first; number <= last; number += 1) {
    rooms.push({
      id: "room-" + hotelId + "-" + number,
      hotelId: hotelId,
      roomNumber: String(number),
      isExtra: false,
      availableFrom: availableFrom
    });
  }
}

function ensureSheets_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const result = {};
  Object.keys(TABLES).forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const headers = TABLES[name];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
      if (headers.some(function (header, index) { return currentHeaders[index] !== header; })) {
        throw new Error("The " + name + " tab has unexpected headers. Do not rename its columns.");
      }
    }
    result[name] = sheet;
  });
  return result;
}

function readData_() {
  const sheets = ensureSheets_();
  const hotels = readRows_(sheets.Hotels).map(function (row) {
    return { id: row[0], name: row[1] };
  });
  const rooms = readRows_(sheets.Rooms).map(function (row) {
    return {
      id: row[0],
      hotelId: row[1],
      roomNumber: row[2],
      isExtra: row[3] === "TRUE",
      availableFrom: row[4] || ""
    };
  });
  const stays = readRows_(sheets.Stays).map(function (row) {
    let segments = [];
    try {
      segments = JSON.parse(row[4] || "[]");
    } catch (error) {
      throw new Error("Stay " + row[0] + " has invalid itinerary JSON in the Stays tab.");
    }
    return {
      id: row[0],
      headGuest: row[1],
      guestCount: Number(row[2]),
      otherGuests: row[3] || "",
      segments: segments,
      documentUrl: row[5] || "",
      documentId: row[6] || "",
      documentName: row[7] || ""
    };
  });
  return { hotels: hotels, rooms: rooms, stays: stays };
}

function readRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, TABLES[sheet.getName()].length)
    .getDisplayValues();
}

function writeData_(sheets, data) {
  writeTable_(sheets.Hotels, TABLES.Hotels, data.hotels.map(function (hotel) {
    return [hotel.id, hotel.name];
  }));
  writeTable_(sheets.Rooms, TABLES.Rooms, data.rooms.map(function (room) {
    return [room.id, room.hotelId, room.roomNumber, Boolean(room.isExtra), room.availableFrom || ""];
  }));
  writeTable_(sheets.Stays, TABLES.Stays, data.stays.map(function (stay) {
    return [
      stay.id,
      stay.headGuest,
      Number(stay.guestCount),
      stay.otherGuests || "",
      JSON.stringify(Array.isArray(stay.segments) ? stay.segments : legacySegments_(stay)),
      stay.documentUrl || "",
      stay.documentId || "",
      stay.documentName || ""
    ];
  }));
}

function writeTable_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length === 0) return;
  const safeRows = rows.map(function (row) {
    return row.map(function (value) {
      return typeof value === "string" && value.charAt(0) === "=" ? "'" + value : value;
    });
  });
  const range = sheet.getRange(2, 1, safeRows.length, headers.length);
  range.setNumberFormat("@");
  range.setValues(safeRows);
}

function legacySegments_(stay) {
  if (!stay.roomId) return [];
  return [{
    roomId: stay.roomId,
    checkInDate: stay.checkInDate,
    checkInTime: stay.checkInTime,
    checkOutDate: stay.checkOutDate,
    checkOutTime: stay.checkOutTime
  }];
}

function validateData_(data) {
  if (!Array.isArray(data.hotels) || !Array.isArray(data.rooms) || !Array.isArray(data.stays)) {
    return "Data must include hotels, rooms, and stays arrays.";
  }
  const hotelIds = new Set();
  for (const hotel of data.hotels) {
    if (!hotel || !hotel.id || !hotel.name || hotelIds.has(hotel.id)) {
      return "Hotels must have unique IDs and non-empty names.";
    }
    hotelIds.add(hotel.id);
  }

  const roomIds = new Set();
  const roomKeys = new Set();
  for (const room of data.rooms) {
    if (!room) return "Every room needs a unique ID, hotel, and room number.";
    const key = room.hotelId + "|" + String(room.roomNumber || "").toLowerCase();
    if (!room.id || !hotelIds.has(room.hotelId) || !room.roomNumber ||
        roomIds.has(room.id) || roomKeys.has(key)) {
      return "Every room needs a unique ID, hotel, and room number.";
    }
    roomIds.add(room.id);
    roomKeys.add(key);
  }

  const assignments = [];
  const stayIds = new Set();
  for (const stay of data.stays) {
    if (!stay || !stay.id || stayIds.has(stay.id) || !String(stay.headGuest || "").trim()) {
      return "Every stay needs a unique ID and a head guest name.";
    }
    stayIds.add(stay.id);
    const guestCount = Number(stay.guestCount);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 30) {
      return "Guest count must be between 1 and 30.";
    }

    const segments = Array.isArray(stay.segments) ? stay.segments : legacySegments_(stay);
    for (const segment of segments) {
      if (!segment) return "Each itinerary segment must reference an existing room and have valid dates and times.";
      const room = data.rooms.find(function (item) { return item.id === segment.roomId; });
      if (!room || !validDateTime_(segment.checkInDate, segment.checkInTime) ||
          !validDateTime_(segment.checkOutDate, segment.checkOutTime)) {
        return "Each itinerary segment must reference an existing room and have valid dates and times.";
      }
      const start = Date.parse(segment.checkInDate + "T" + segment.checkInTime + ":00Z");
      const end = Date.parse(segment.checkOutDate + "T" + segment.checkOutTime + ":00Z");
      if (start >= end) return "Every check-out must be after its check-in.";
      if (room.availableFrom && segment.checkInDate < room.availableFrom) {
        return "A stay cannot begin before the room's available-from date.";
      }
      assignments.push({ stayId: stay.id, roomId: room.id, start: start, end: end });
    }

    const documentUrl = String(stay.documentUrl || "");
    if (documentUrl) {
      if (!/^https:\/\/(?:drive\.google\.com|docs\.google\.com)(?:\/|$)/i.test(documentUrl)) {
        return "Document links must be valid Google Drive or Docs HTTPS URLs.";
      }
    }
  }

  for (let i = 0; i < assignments.length; i += 1) {
    for (let j = i + 1; j < assignments.length; j += 1) {
      const left = assignments[i];
      const right = assignments[j];
      if (left.stayId !== right.stayId && left.roomId === right.roomId &&
          left.start < right.end && left.end > right.start) {
        return "Room booking conflict: a room cannot have overlapping stays.";
      }
    }
  }
  return "";
}

function validDateTime_(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) return false;
  const parsed = new Date(date + "T" + time + ":00Z");
  return !isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    parsed.toISOString().slice(11, 16) === time;
}

function getRevision_() {
  return PropertiesService.getScriptProperties().getProperty(REVISION_KEY) || "0";
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

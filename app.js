const STORAGE_KEY = "stayboard-data-v1";
const DEFAULT_HOTELS = [
  { id: "hotel-1", name: "Krati Resort" },
  { id: "hotel-2", name: "Jass Grand" },
  { id: "hotel-3", name: "Maantra" }
];
const DEFAULT_ROOM_NUMBERS = ["1", "2", "3"];

const state = {
  data: loadData(),
  persistedData: null,
  backendRevision: "",
  backendReady: false,
  selectedHotel: "all",
  currentPage: "overview",
  overviewTab: "all",
  searchQuery: "",
  hotelDates: {},
  roomDataHotel: "",
  collapsedHotels: new Set(),
  toastTimer: null
};

const byId = (id) => document.getElementById(id);
const hotelNav = byId("hotel-nav");
const hotelContent = byId("hotel-content");
const stayDialog = byId("stay-dialog");
const roomDialog = byId("room-dialog");
const hotelDialog = byId("hotel-dialog");
const isCloudApp = Boolean(window.STAYBOARD_CONFIG?.googleClientId);

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const data = { hotels: structuredClone(DEFAULT_HOTELS), rooms: [], stays: [] };
      data.rooms = createDefaultRooms(data.hotels);
      return data;
    }
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.hotels) || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.stays)) {
      throw new Error("Saved hotel data has an unexpected format.");
    }
    let hotelsRenamed = false;
    parsed.hotels = parsed.hotels.map((hotel) => {
      const defaultHotel = DEFAULT_HOTELS.find((entry) => entry.id === hotel.id);
      if (!defaultHotel || !/^Hotel \d+$/.test(hotel.name)) return hotel;
      hotelsRenamed = true;
      return { ...hotel, name: defaultHotel.name };
    });
    const inventoryUpdated = applyDefaultInventoryPlan(parsed);
    if (hotelsRenamed || inventoryUpdated) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error("Could not load saved hotel data.", error);
    return { hotels: structuredClone(DEFAULT_HOTELS), rooms: [], stays: [] };
  }
}

function createDefaultRooms(hotels) {
  return hotels.flatMap((hotel) => DEFAULT_ROOM_NUMBERS.map((roomNumber) => ({
    id: makeId("room"), hotelId: hotel.id, roomNumber, isExtra: false
  })));
}

function applyDefaultInventoryPlan(data) {
  let changed = false;
  for (const hotel of data.hotels) {
    const currentHotelRooms = data.rooms.filter((room) => room.hotelId === hotel.id);
    const hasBookings = data.stays.some((stay) =>
      segmentsForStay(stay).some((segment) =>
        currentHotelRooms.some((room) => room.id === segment.roomId)
      )
    );
    if (hasBookings) continue;

    const desiredNumbers = new Set(DEFAULT_ROOM_NUMBERS);
    const desiredRooms = currentHotelRooms.filter((room) => desiredNumbers.has(room.roomNumber));
    if (currentHotelRooms.length !== desiredRooms.length ||
        desiredRooms.some((room) => room.availableFrom)) {
      data.rooms = data.rooms.filter((room) => room.hotelId !== hotel.id || desiredNumbers.has(room.roomNumber));
      for (const room of data.rooms.filter((entry) => entry.hotelId === hotel.id)) {
        delete room.availableFrom;
      }
      changed = true;
    }

    for (const roomNumber of DEFAULT_ROOM_NUMBERS) {
      if (!data.rooms.some((room) => room.hotelId === hotel.id && room.roomNumber === roomNumber)) {
        data.rooms.push({
          id: makeId("room"),
          hotelId: hotel.id,
          roomNumber,
          isExtra: false
        });
        changed = true;
      }
    }
  }
  return changed;
}

async function saveData() {
  if (isCloudApp) {
    try {
      const response = await fetchSharedData({
        action: "save",
        revision: state.backendRevision,
        data: state.data
      });
      if (!response.ok) {
        if (response.error === "STALE_DATA") {
          throw new Error("Someone else has changed the shared data. Reload the page before trying again.");
        }
        throw new Error(response.message || response.error || "Could not save shared data.");
      }
      state.backendRevision = response.revision;
      state.persistedData = structuredClone(state.data);
      return true;
    } catch (error) {
      if (state.persistedData) state.data = structuredClone(state.persistedData);
      render();
      console.error("Could not save shared hotel data.", error);
      showToast(error.message || "Could not save shared data.");
      return false;
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (error) {
    console.error("Could not save hotel data.", error);
    showToast("Could not save changes in this browser. Check available storage.");
    return false;
  }
  return true;
}

async function fetchSharedData(body) {
  const response = await fetch("/api/data", {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("The shared-data service returned an invalid response.");
  }
  if (response.status === 401 && isCloudApp) {
    byId("startup-overlay")?.classList.remove("hidden");
    showSignIn("Your 7-day session expired. Sign in again.");
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.message || result.error || `Shared-data request failed (${response.status}).`);
  }
  return result;
}

async function initializeSharedData() {
  const overlay = byId("startup-overlay");
  if (!isCloudApp) {
    state.backendReady = true;
    overlay?.classList.add("hidden");
    byId("footer-message").textContent = "Not shared yet: bookings and links stay in this browser; Drive files stay in Drive.";
    render();
    return;
  }

  byId("startup-title").textContent = "Checking your session…";
  byId("startup-error").textContent = "";
  try {
    const response = await fetch("/api/auth", { cache: "no-store" });
    if (response.ok) {
      await loadSharedData();
      return;
    }
    if (response.status !== 401) {
      const result = await response.json();
      throw new Error(result.error || "Could not check your Stayboard session.");
    }
    showSignIn();
  } catch (error) {
    console.error("Could not check the Stayboard session.", error);
    byId("startup-title").textContent = "Could not connect";
    byId("startup-error").textContent = error.message || "Check your connection and try again.";
    byId("startup-retry")?.classList.remove("hidden");
  }
}

function showSignIn(message = "Sign in once; this browser will stay signed in for 7 days.") {
  if (!window.google?.accounts?.id) {
    byId("startup-title").textContent = "Google sign-in is unavailable";
    byId("startup-error").textContent = "Check your internet connection and reload the page.";
    byId("startup-retry")?.classList.remove("hidden");
    return;
  }

  byId("startup-title").textContent = "Sign in to Stayboard";
  byId("startup-error").textContent = message;
  byId("google-signin-button").replaceChildren();
  google.accounts.id.initialize({
    client_id: window.STAYBOARD_CONFIG.googleClientId,
    callback: handleGoogleCredential,
    use_fedcm_for_button: true
  });
  google.accounts.id.renderButton(byId("google-signin-button"), {
    theme: "outline",
    size: "large",
    text: "signin_with"
  });
}

async function handleGoogleCredential(credentialResponse) {
  byId("startup-error").textContent = "Loading shared hotel data…";
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: credentialResponse.credential })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Google sign-in could not be completed.");
    }
    await loadSharedData();
  } catch (error) {
    console.error("Could not sign in to shared hotel data.", error);
    byId("startup-error").textContent = error.message || "Could not sign in.";
  }
}

async function loadSharedData() {
  try {
    const response = await fetchSharedData();
    if (!response.ok || !response.data) {
      throw new Error(response.error || "The shared hotel data could not be loaded.");
    }
    state.data = response.data;
    state.persistedData = structuredClone(response.data);
    state.backendRevision = response.revision;
    state.backendReady = true;
    byId("footer-message").textContent = "Shared data syncs through your Google Sheet; Drive files stay in Drive.";
    byId("startup-overlay")?.classList.add("hidden");
    render();
  } catch (error) {
    console.error("Could not load shared hotel data.", error);
    const message = byId("startup-error");
    if (message) {
      message.textContent = error.message || "Could not load shared hotel data.";
      if (!state.backendReady) byId("startup-retry")?.classList.remove("hidden");
    }
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function hotelById(id) {
  return state.data.hotels.find((hotel) => hotel.id === id);
}

function roomById(id) {
  return state.data.rooms.find((room) => room.id === id);
}

function localDateTime(date, time) {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function addDateDays(date, days) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return dateKey(result);
}

function segmentsForStay(stay) {
  if (Array.isArray(stay.segments)) return stay.segments;
  if (!stay.roomId) return [];
  return [{
    roomId: stay.roomId,
    checkInDate: stay.checkInDate,
    checkInTime: stay.checkInTime,
    checkOutDate: stay.checkOutDate,
    checkOutTime: stay.checkOutTime
  }];
}

function roomAssignments() {
  return state.data.stays.flatMap((stay) =>
    segmentsForStay(stay).map((segment) => ({ ...stay, ...segment, stayId: stay.id }))
  );
}

function currentStay(roomId, now = new Date()) {
  return roomAssignments().find((assignment) =>
    assignment.roomId === roomId &&
    localDateTime(assignment.checkInDate, assignment.checkInTime) <= now &&
    localDateTime(assignment.checkOutDate, assignment.checkOutTime) > now
  );
}

function roomAvailableOn(room, date) {
  return !room.availableFrom || room.availableFrom <= date;
}

function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function render() {
  renderNav();
  renderDashboard();
  renderHotels();
  renderPage();
}

function renderNav() {
  const allActive = state.selectedHotel === "all";
  hotelNav.innerHTML = `
    <button class="nav-item ${allActive && state.currentPage === "overview" ? "active" : ""}" type="button" data-hotel="all">
      <span class="nav-symbol">⌂</span><span>Overview</span>
    </button>
    ${state.data.hotels.map((hotel, index) => {
      const count = state.data.rooms.filter((room) => room.hotelId === hotel.id).length;
      return `<button class="nav-item ${state.selectedHotel === hotel.id && state.currentPage === "overview" ? "active" : ""}" type="button" data-hotel="${escapeHtml(hotel.id)}">
        <span class="nav-symbol">${["⌂", "⌑", "⌂"][index % 3]}</span><span>${escapeHtml(hotel.name)}</span><span class="nav-room-count">${count}</span>
      </button>`;
    }).join("")}
    <button class="nav-item ${state.currentPage === "bulk" ? "active" : ""}" type="button" data-page="bulk">
      <span class="nav-symbol">＋</span><span>Bulk add rooms</span>
    </button>
    <button class="nav-item ${state.currentPage === "manageRooms" ? "active" : ""}" type="button" data-page="manage-rooms">
      <span class="nav-symbol">▤</span><span>Update room data</span>
    </button>`;
  hotelNav.querySelectorAll("[data-hotel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedHotel = button.dataset.hotel;
      state.currentPage = "overview";
      render();
    });
  });
  hotelNav.querySelector("[data-page='bulk']").addEventListener("click", () => {
    state.currentPage = "bulk";
    render();
  });
  hotelNav.querySelector("[data-page='manage-rooms']").addEventListener("click", () => {
    state.currentPage = "manageRooms";
    render();
  });
}

function renderDashboard() {
  const selected = state.selectedHotel === "all" ? null : hotelById(state.selectedHotel);
  const rooms = selected
    ? state.data.rooms.filter((room) => room.hotelId === selected.id)
    : state.data.rooms;
  const now = new Date();
  const activeRooms = rooms.filter((room) => roomAvailableOn(room, dateKey(now)));
  const occupied = rooms.map((room) => ({ room, stay: currentStay(room.id, now) })).filter((item) => item.stay);
  const arrivals = roomAssignments().filter((assignment) =>
    assignment.checkInDate === dateKey(now) &&
    rooms.some((room) => room.id === assignment.roomId)
  );
  byId("rooms-stat-caption").textContent = selected ? selected.name.toLocaleUpperCase() : "ACROSS ALL HOTELS";
  byId("stat-rooms").innerHTML = `${rooms.length} <span>rooms</span>`;
  byId("stat-available").textContent = `${Math.max(0, activeRooms.length - occupied.length)} available today`;
  byId("stat-occupied").innerHTML = `${occupied.length} <span>rooms</span>`;
  byId("stat-guests").innerHTML = `${occupied.reduce((total, item) => total + Number(item.stay.guestCount), 0)} <span>people</span>`;
  byId("stat-arrivals").innerHTML = `${arrivals.length} <span>groups</span>`;
  byId("hotel-count").textContent = state.data.hotels.length;
  byId("today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now);

  byId("page-crumb").textContent = selected ? selected.name : "Overview";
  byId("heading-eyebrow").textContent = selected ? "HOTEL OVERVIEW" : "YOUR PROPERTIES";
  byId("page-title").innerHTML = selected ? `${escapeHtml(selected.name)} <span class="wave">✦</span>` : `Good day <span class="wave">✦</span>`;
  byId("page-subtitle").textContent = selected
    ? "Manage rooms, stays, and guest details for this hotel."
    : "Here’s what’s happening across your hotels.";
  byId("rooms-title").textContent = selected ? "Rooms" : "Your hotels";
  const selectedDate = selected ? state.hotelDates[selected.id] || "" : "";
  byId("rooms-caption").textContent = selected
    ? selectedDate ? `Showing room status for ${formatDate(selectedDate)}.` : "Choose a date to filter this hotel's room status."
    : state.overviewTab === "today"
      ? "Rooms booked on each hotel's selected date, or across all dates."
      : "Select a hotel to view its rooms and guests.";
  byId("all-rooms-tab").classList.toggle("active", state.overviewTab === "all");
  byId("today-tab").classList.toggle("active", state.overviewTab === "today");
  byId("guest-search").value = state.searchQuery;
}

function renderPage() {
  const isBulkPage = state.currentPage === "bulk";
  const isRoomDataPage = state.currentPage === "manageRooms";
  byId("bulk-page").classList.toggle("hidden", !isBulkPage);
  byId("room-data-page").classList.toggle("hidden", !isRoomDataPage);
  byId("stats-grid").classList.toggle("hidden", isBulkPage || isRoomDataPage);
  byId("rooms-section").classList.toggle("hidden", isBulkPage || isRoomDataPage);
  byId("add-stay-button").classList.toggle("hidden", isBulkPage || isRoomDataPage);
  byId("add-room-button").classList.toggle("hidden", isBulkPage || isRoomDataPage);
  if (isBulkPage) {
    byId("page-crumb").textContent = "Bulk add rooms";
    byId("heading-eyebrow").textContent = "PROPERTY SETUP";
    byId("page-title").textContent = "Add rooms in bulk";
    byId("page-subtitle").textContent = "Set up multiple room numbers at once.";
    const select = byId("bulk-hotel-select");
    const selectedHotelId = state.selectedHotel !== "all" ? state.selectedHotel : select.value;
    select.innerHTML = state.data.hotels.map((hotel) =>
      `<option value="${escapeHtml(hotel.id)}">${escapeHtml(hotel.name)}</option>`
    ).join("");
    if (hotelById(selectedHotelId)) select.value = selectedHotelId;
  } else if (isRoomDataPage) {
    byId("page-crumb").textContent = "Update room data";
    byId("heading-eyebrow").textContent = "ROOM MANAGEMENT";
    byId("page-title").textContent = "Update room data";
    byId("page-subtitle").textContent = "Edit existing room details and availability.";
    renderRoomManagement();
  }
}

function dateKey(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function renderHotels() {
  const query = state.searchQuery.trim().toLocaleLowerCase();
  if (query) {
    renderSearchResults(query);
    return;
  }

  const hotels = state.selectedHotel === "all"
    ? state.data.hotels
    : state.data.hotels.filter((hotel) => hotel.id === state.selectedHotel);
  const visibleHotels = hotels.map((hotel) => {
    const hotelRooms = state.data.rooms.filter((room) => room.hotelId === hotel.id);
    const selectedDate = state.hotelDates[hotel.id] || "";
    const availableRooms = selectedDate
      ? hotelRooms.filter((room) => roomAvailableOn(room, selectedDate))
      : hotelRooms;
    const rooms = state.overviewTab === "today"
      ? availableRooms.filter((room) => selectedDate
        ? assignmentOnDate(room.id, selectedDate)
        : roomAssignments().some((assignment) => assignment.roomId === room.id))
      : availableRooms;
    return { hotel, rooms, totalRooms: hotelRooms.length, selectedDate };
  });

  hotelContent.innerHTML = visibleHotels.map(({ hotel, rooms, totalRooms, selectedDate }) => {
    rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    const collapsed = state.collapsedHotels.has(hotel.id);
    const panelId = `hotel-rooms-${hotel.id}`;
    return `<article class="hotel-panel">
      <header class="hotel-panel-header">
        <div class="hotel-title">
          <span class="hotel-monogram">${escapeHtml(hotel.name.slice(0, 1).toUpperCase())}</span>
          <div><h3>${escapeHtml(hotel.name)}</h3><p>${state.overviewTab === "today"
            ? `${rooms.length} booked · ${totalRooms} total`
            : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`}</p></div>
        </div>
        <div class="hotel-panel-actions">
          <div class="hotel-date-filter">
            <span>Date</span>
            <input type="date" value="${escapeHtml(selectedDate)}" data-hotel-date="${escapeHtml(hotel.id)}" aria-label="Filter ${escapeHtml(hotel.name)} by date">
            <button class="clear-hotel-date" type="button" data-clear-hotel-date="${escapeHtml(hotel.id)}" aria-label="Clear ${escapeHtml(hotel.name)} date filter" ${selectedDate ? "" : "disabled"}>×</button>
          </div>
          <button class="hotel-action-button hotel-collapse ${collapsed ? "is-collapsed" : ""}" type="button" data-toggle-hotel="${escapeHtml(hotel.id)}"
            aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(hotel.name)} rooms" title="${collapsed ? "Expand rooms" : "Collapse rooms"}"
            aria-expanded="${!collapsed}" aria-controls="${escapeHtml(panelId)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button class="hotel-action-button" type="button" data-rename-hotel="${escapeHtml(hotel.id)}"
            aria-label="Rename ${escapeHtml(hotel.name)}" title="Rename hotel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
          </button>
          <button class="hotel-action-button" type="button" data-add-room="${escapeHtml(hotel.id)}"
            aria-label="Add room to ${escapeHtml(hotel.name)}" title="Add room">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </button>
        </div>
      </header>
      <div class="hotel-panel-content ${collapsed ? "hidden" : ""}" id="${escapeHtml(panelId)}">
        ${rooms.length ? `<div class="room-grid">${rooms.map((room) => {
          const assignment = selectedDate
            ? assignmentOnDate(room.id, selectedDate)
            : state.overviewTab === "today"
              ? assignmentAcrossDates(room.id)
              : null;
          return renderRoom(room, assignment, selectedDate, Boolean(selectedDate));
        }).join("")}</div>` : `
          <div class="empty-hotel"><div><strong>${state.overviewTab === "today" ? "No bookings on this date" : "No rooms available on this date"}</strong><p>${state.overviewTab === "today" ? "Try another date or view all rooms." : "Choose another date or add rooms to this hotel."}</p></div>
            ${state.overviewTab === "today" ? "" : `<button class="hotel-action-button empty-hotel-add" type="button" data-add-room="${escapeHtml(hotel.id)}" aria-label="Add room to ${escapeHtml(hotel.name)}" title="Add room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>`}</div>`}
      </div>
    </article>`;
  }).join("");

  hotelContent.querySelectorAll("[data-hotel-date]").forEach((input) => {
    input.addEventListener("change", () => {
      state.hotelDates[input.dataset.hotelDate] = input.value;
      renderDashboard();
      renderHotels();
    });
  });
  hotelContent.querySelectorAll("[data-clear-hotel-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.hotelDates[button.dataset.clearHotelDate] = "";
      renderDashboard();
      renderHotels();
    });
  });
  hotelContent.querySelectorAll("[data-toggle-hotel]").forEach((button) => {
    button.addEventListener("click", () => {
      const hotelId = button.dataset.toggleHotel;
      if (state.collapsedHotels.has(hotelId)) state.collapsedHotels.delete(hotelId);
      else state.collapsedHotels.add(hotelId);
      renderHotels();
    });
  });
  hotelContent.querySelectorAll("[data-add-room]").forEach((button) => {
    button.addEventListener("click", () => openRoomDialog(button.dataset.addRoom));
  });
  hotelContent.querySelectorAll("[data-rename-hotel]").forEach((button) => {
    button.addEventListener("click", () => openHotelDialog(button.dataset.renameHotel));
  });
  hotelContent.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.stayId) {
        openStayDetails(button.dataset.stayId);
      } else {
        const room = roomById(button.dataset.room);
        if (button.dataset.dateFiltered) {
          openStayDialog(room.id, "", button.dataset.selectedDate);
          return;
        }
        const upcoming = roomAssignments().find((entry) =>
          entry.roomId === room.id && localDateTime(entry.checkInDate, entry.checkInTime) > new Date()
        );
        if (upcoming) openStayDetails(upcoming.stayId);
        else openStayDialog(room.id);
      }
    });
  });
  hotelContent.querySelectorAll("[data-view-stay]").forEach((button) => {
    button.addEventListener("click", () => openStayDetails(button.dataset.viewStay));
  });
}

function assignmentOnDate(roomId, date) {
  const room = roomById(roomId);
  if (!room || !roomAvailableOn(room, date)) return null;

  const dayStart = localDateTime(date, "00:00");
  const dayEnd = localDateTime(addDateDays(date, 1), "00:00");
  const assignments = roomAssignments().filter((assignment) =>
    assignment.roomId === roomId &&
    localDateTime(assignment.checkInDate, assignment.checkInTime) < dayEnd &&
    localDateTime(assignment.checkOutDate, assignment.checkOutTime) > dayStart
  );
  const midday = localDateTime(date, "12:00");
  return assignments.find((assignment) =>
    localDateTime(assignment.checkInDate, assignment.checkInTime) <= midday &&
    localDateTime(assignment.checkOutDate, assignment.checkOutTime) > midday
  ) || assignments.sort((a, b) =>
    localDateTime(a.checkInDate, a.checkInTime) - localDateTime(b.checkInDate, b.checkInTime)
  )[0] || null;
}

function assignmentAcrossDates(roomId) {
  const assignments = roomAssignments()
    .filter((assignment) => assignment.roomId === roomId)
    .sort((a, b) =>
      localDateTime(a.checkInDate, a.checkInTime) - localDateTime(b.checkInDate, b.checkInTime)
    );
  const now = new Date();
  return assignments.find((assignment) =>
    localDateTime(assignment.checkInDate, assignment.checkInTime) <= now &&
    localDateTime(assignment.checkOutDate, assignment.checkOutTime) > now
  ) || assignments.find((assignment) =>
    localDateTime(assignment.checkOutDate, assignment.checkOutTime) > now
  ) || assignments[assignments.length - 1] || null;
}

function renderRoomManagement() {
  const hotelSelect = byId("room-data-hotel");
  const selectedHotelId = state.roomDataHotel ||
    (state.selectedHotel !== "all" ? state.selectedHotel : "");
  hotelSelect.innerHTML = `<option value="">All hotels</option>${state.data.hotels.map((hotel) =>
    `<option value="${escapeHtml(hotel.id)}">${escapeHtml(hotel.name)}</option>`
  ).join("")}`;
  if (hotelById(selectedHotelId)) hotelSelect.value = selectedHotelId;

  const rooms = state.data.rooms
    .filter((room) => !hotelSelect.value || room.hotelId === hotelSelect.value)
    .sort((a, b) => {
      const hotelOrder = hotelById(a.hotelId).name.localeCompare(hotelById(b.hotelId).name);
      return hotelOrder || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
    });
  byId("room-data-count").textContent = `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`;
  byId("room-data-error").textContent = "";
  byId("room-data-rows").innerHTML = rooms.map((room) => `
    <tr data-room-row="${escapeHtml(room.id)}">
      <td>${hotelSelect.value ? "" : `<span class="room-data-hotel-name">${escapeHtml(hotelById(room.hotelId).name)}</span>`}
        <input name="roomNumber" aria-label="Room number${hotelSelect.value ? "" : ` at ${escapeHtml(hotelById(room.hotelId).name)}`}" value="${escapeHtml(room.roomNumber)}" required></td>
      <td><input name="availableFrom" type="date" aria-label="Available from for room ${escapeHtml(room.roomNumber)}" value="${escapeHtml(room.availableFrom || "")}"></td>
      <td><input name="isExtra" type="checkbox" aria-label="Mark room ${escapeHtml(room.roomNumber)} as extra" ${room.isExtra ? "checked" : ""}></td>
    </tr>`).join("") || `<tr><td class="room-data-empty" colspan="3">No rooms in this hotel yet.</td></tr>`;
}

function renderSearchResults(query) {
  const matches = state.data.stays.filter((stay) => {
    const groupNames = [stay.headGuest, ...(stay.otherGuests || "").split(/[,;\n]/)]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return groupNames.includes(query);
  });
  if (!matches.length) {
    hotelContent.innerHTML = `<div class="empty-state"><strong>No guests found</strong>Try another name or part of a name.</div>`;
    return;
  }

  hotelContent.innerHTML = matches.map((stay) => {
    const guestNames = [stay.headGuest, ...(stay.otherGuests || "").split(/[,;\n]/)]
      .map((name) => name.trim())
      .filter(Boolean);
    const itinerary = segmentsForStay(stay).map((segment) => {
      const room = roomById(segment.roomId);
      const hotel = hotelById(room?.hotelId);
      return `<li><strong>${escapeHtml(hotel?.name || "Hotel")} · Room ${escapeHtml(room?.roomNumber || "?")}</strong>
        <span>${formatDate(segment.checkInDate)} – ${formatDate(segment.checkOutDate)}</span></li>`;
    }).join("");
    return `<article class="search-result">
      <button class="search-result-main" type="button" data-view-stay="${escapeHtml(stay.id)}">
        <span class="search-result-heading"><strong>${escapeHtml(stay.headGuest)}</strong><span>${Number(stay.guestCount)} ${Number(stay.guestCount) === 1 ? "person" : "people"}</span></span>
        <span class="search-result-guests">${escapeHtml(guestNames.join(", "))}</span>
        <ul class="search-itinerary">${itinerary}</ul>
        ${stay.documentUrl ? '<span class="document-mark">▧ Drive document</span>' : ""}
      </button>
    </article>`;
  }).join("");

  hotelContent.querySelectorAll("[data-view-stay]").forEach((button) => {
    button.addEventListener("click", () => openStayDetails(button.dataset.viewStay));
  });
}

function renderRoom(room, assignmentOverride = null, selectedDate = dateKey(new Date()), dateFiltered = false) {
  const hotel = hotelById(room.hotelId);
  const today = dateKey(new Date());
  const activeStay = !dateFiltered || selectedDate === today ? currentStay(room.id) : null;
  const stay = dateFiltered ? assignmentOverride : activeStay || assignmentOverride || roomAssignments()
    .filter((entry) => entry.roomId === room.id && localDateTime(entry.checkInDate, entry.checkInTime) > new Date())
    .sort((a, b) => localDateTime(a.checkInDate, a.checkInTime) - localDateTime(b.checkInDate, b.checkInTime))[0];
  const isUpcoming = dateFiltered
    ? Boolean(stay && !activeStay && stay.checkInDate === selectedDate &&
      (selectedDate > today || localDateTime(stay.checkInDate, stay.checkInTime) > new Date()))
    : Boolean(stay && !activeStay && !assignmentOverride);
  const isTodayArrival = Boolean(dateFiltered
    ? stay && selectedDate === today && !activeStay && stay.checkInDate === today
    : assignmentOverride && !activeStay && assignmentOverride.checkInDate === today);
  const isNotOpen = !stay && !roomAvailableOn(room, selectedDate);
  let statusLabel;
  if (isTodayArrival) statusLabel = "Arriving today";
  else if (dateFiltered && activeStay) statusLabel = room.isExtra ? "Extra · occupied" : "Occupied";
  else if (dateFiltered && stay?.checkOutDate === selectedDate) statusLabel = "Checking out";
  else if (dateFiltered && stay) statusLabel = room.isExtra ? "Extra · booked" : "Booked";
  else if (assignmentOverride) statusLabel = room.isExtra ? "Extra · booked" : "Booked";
  else if (activeStay && assignmentOverride?.checkOutDate === today) statusLabel = "Checks out today";
  else if (activeStay) statusLabel = room.isExtra ? "Extra · occupied" : "Occupied";
  else if (isUpcoming) statusLabel = "Upcoming";
  else if (isNotOpen) statusLabel = `Opens ${formatDate(room.availableFrom)}`;
  else statusLabel = room.isExtra ? "Extra" : "Available";

  const classes = ["room-card", activeStay || assignmentOverride || dateFiltered && stay && !isUpcoming ? "occupied" : "", isUpcoming ? "upcoming" : "", isNotOpen ? "not-open" : "", room.isExtra ? "extra" : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" type="button" data-room="${escapeHtml(room.id)}" ${dateFiltered ? `data-date-filtered="true" data-selected-date="${escapeHtml(selectedDate)}"` : ""} ${stay?.stayId ? `data-stay-id="${escapeHtml(stay.stayId)}"` : ""} aria-label="Room ${escapeHtml(room.roomNumber)} at ${escapeHtml(hotel?.name || "hotel")}: ${stay ? `${escapeHtml(stay.headGuest)}, ${stay.guestCount} people` : statusLabel}">
    <span class="room-card-top"><span class="room-number">Room ${escapeHtml(room.roomNumber)}</span><span class="room-state">${statusLabel}</span></span>
    ${stay ? `<span class="room-guest">${escapeHtml(stay.headGuest)}</span><span class="room-meta"><strong>${Number(stay.guestCount)} ${Number(stay.guestCount) === 1 ? "person" : "people"}</strong> ${isUpcoming || dateFiltered ? "booked" : isTodayArrival ? "arriving today" : "in this room"}</span>
      <span class="room-card-footer"><span>${formatDate(stay.checkInDate)} – ${formatDate(stay.checkOutDate)}</span>${stay.documentId || stay.documentUrl ? '<span class="document-mark" aria-label="Guest document linked">▧ Doc</span>' : ""}</span>`
      : `<span class="room-guest" style="color:#85878b;font-weight:500">${isNotOpen ? "Not available yet" : "Ready for a stay"}</span><span class="room-meta">${isNotOpen ? `Available from ${formatDate(room.availableFrom)}` : room.isExtra ? "Special / additional room" : "No current guests"}</span>`}
  </button>`;
}

function openStayDetails(stayId) {
  const stay = state.data.stays.find((entry) => entry.id === stayId);
  if (!stay) return;
  const guestNames = (stay.otherGuests || "").split(/[,;\n]/).map((name) => name.trim()).filter(Boolean);
  const itinerary = segmentsForStay(stay).map((segment) => {
    const room = roomById(segment.roomId);
    const hotel = hotelById(room?.hotelId);
    return `<li class="stay-detail-segment">
      <strong>${escapeHtml(hotel?.name || "Hotel")} · Room ${escapeHtml(room?.roomNumber || "?")}</strong>
      <span><b>Check-in</b> ${formatDate(segment.checkInDate)}${segment.checkInTime ? ` at ${escapeHtml(segment.checkInTime)}` : ""}</span>
      <span><b>Check-out</b> ${formatDate(segment.checkOutDate)}${segment.checkOutTime ? ` at ${escapeHtml(segment.checkOutTime)}` : ""}</span>
    </li>`;
  }).join("");
  const documentLink = stay.documentUrl
    ? `<a class="button button-secondary" href="${escapeHtml(stay.documentUrl)}" target="_blank" rel="noopener noreferrer">Open document in Google Drive ↗</a>`
    : stay.documentId
      ? `<p class="file-hint">An older browser-stored attachment has no Google Drive link.</p>`
      : "";

  byId("stay-detail-title").textContent = stay.headGuest;
  byId("stay-detail-content").innerHTML = `
    <dl class="stay-detail-summary">
      <div><dt>Head guest</dt><dd>${escapeHtml(stay.headGuest)}</dd></div>
      <div><dt>Group size</dt><dd>${Number(stay.guestCount)} ${Number(stay.guestCount) === 1 ? "person" : "people"}</dd></div>
      ${guestNames.length ? `<div><dt>Other guests</dt><dd>${escapeHtml(guestNames.join(", "))}</dd></div>` : ""}
    </dl>
    <section class="stay-detail-itinerary">
      <h3>Room itinerary</h3>
      <ul>${itinerary || "<li>No room itinerary recorded.</li>"}</ul>
    </section>
    ${documentLink ? `<section class="stay-detail-document"><h3>Guest document</h3>${documentLink}</section>` : ""}
  `;
  byId("edit-stay-detail").dataset.stayId = stay.id;
  byId("stay-detail-dialog").showModal();
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function openRoomDialog(hotelId = "") {
  const form = byId("room-form");
  form.reset();
  byId("room-error").textContent = "";
  const select = form.elements.hotelId;
  select.innerHTML = state.data.hotels.map((hotel) =>
    `<option value="${escapeHtml(hotel.id)}">${escapeHtml(hotel.name)}</option>`
  ).join("");
  if (hotelId) select.value = hotelId;
  roomDialog.showModal();
  form.elements.roomNumber.focus();
}

function openHotelDialog(hotelId) {
  const hotel = hotelById(hotelId);
  if (!hotel) return;
  const form = byId("hotel-form");
  byId("hotel-error").textContent = "";
  form.elements.hotelId.value = hotel.id;
  form.elements.hotelName.value = hotel.name;
  hotelDialog.showModal();
  form.elements.hotelName.focus();
}

function addItinerarySegment(segment = {}) {
  const container = byId("stay-segments");
  const index = container.children.length;
  const previous = container.lastElementChild;
  const previousCheckOut = previous?.querySelector('[data-segment-field="checkOutDate"]')?.value;
  const today = dateKey(new Date());
  const selectedRoom = roomById(segment.roomId);
  const selectedHotelId = selectedRoom?.hotelId || segment.hotelId ||
    (state.selectedHotel !== "all" ? state.selectedHotel : state.data.hotels[0]?.id || "");
  const defaultCheckInDate = selectedRoom?.availableFrom && selectedRoom.availableFrom > today
    ? selectedRoom.availableFrom
    : today;
  const checkInDate = segment.checkInDate || previousCheckOut || defaultCheckInDate;
  const checkOutDate = segment.checkOutDate || addDateDays(checkInDate, 1);
  const checkInTime = segment.checkInTime || (index > 0
    ? previous?.querySelector('[data-segment-field="checkOutTime"]')?.value || "12:00"
    : "12:00");
  const checkOutTime = segment.checkOutTime || "11:00";
  const hotelOptions = state.data.hotels
    .map((hotel) => `<option value="${escapeHtml(hotel.id)}">${escapeHtml(hotel.name)}</option>`)
    .join("");
  const segmentElement = document.createElement("section");
  segmentElement.className = "itinerary-segment";
  segmentElement.dataset.itinerarySegment = "";
  segmentElement.innerHTML = `
    <header class="itinerary-segment-header">
      <strong>Stay ${index + 1}</strong>
      ${index ? '<button class="text-button remove-segment" type="button">Remove</button>' : ""}
    </header>
    <div class="itinerary-room-selection">
      <label class="field">Hotel
        <select data-segment-field="hotelId" required>${hotelOptions}</select>
      </label>
      <label class="field">Room
        <select data-segment-field="roomId" required></select>
      </label>
    </div>
    <div class="itinerary-dates">
      <label class="field">Check-in date
        <input data-segment-field="checkInDate" type="date" required>
      </label>
      <label class="field">Time<input data-segment-field="checkInTime" type="time" required></label>
      <label class="field">Check-out date
        <input data-segment-field="checkOutDate" type="date" required>
      </label>
      <label class="field">Time<input data-segment-field="checkOutTime" type="time" required></label>
    </div>`;
  segmentElement.querySelector('[data-segment-field="checkInDate"]').value = checkInDate;
  segmentElement.querySelector('[data-segment-field="checkInTime"]').value = checkInTime;
  segmentElement.querySelector('[data-segment-field="checkOutDate"]').value = checkOutDate;
  segmentElement.querySelector('[data-segment-field="checkOutTime"]').value = checkOutTime;
  segmentElement.querySelector('[data-segment-field="hotelId"]').value = selectedHotelId;
  updateSegmentRoomOptions(segmentElement, segment.roomId || "");
  container.append(segmentElement);
}

function updateSegmentRoomOptions(segmentElement, selectedRoomId = "") {
  const hotelSelect = segmentElement.querySelector('[data-segment-field="hotelId"]');
  const roomSelect = segmentElement.querySelector('[data-segment-field="roomId"]');
  const hotelId = hotelSelect.value;
  const rooms = state.data.rooms
    .filter((room) => room.hotelId === hotelId)
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  roomSelect.innerHTML = `<option value="">Select a room</option>${rooms.map((room) =>
    `<option value="${escapeHtml(room.id)}">Room ${escapeHtml(room.roomNumber)}</option>`
  ).join("")}`;
  if (rooms.some((room) => room.id === selectedRoomId)) roomSelect.value = selectedRoomId;
  roomSelect.disabled = rooms.length === 0;
}

function setItinerarySegments(segments) {
  byId("stay-segments").replaceChildren();
  for (const segment of segments) addItinerarySegment(segment);
  if (segments.length === 0) addItinerarySegment();
}

function openStayDialog(roomId, stayId = "", selectedDate = "") {
  const form = byId("stay-form");
  form.reset();
  setItinerarySegments(selectedDate ? [{ roomId, checkInDate: selectedDate }] : []);
  byId("stay-error").textContent = "";
  byId("existing-document-hint").textContent = "";
  byId("open-document-link").classList.add("hidden");
  byId("open-document-link").removeAttribute("href");
  form.elements.documentUrl.value = "";
  byId("delete-stay-button").classList.add("hidden");
  const stay = stayId && state.data.stays.find((entry) => entry.id === stayId);
  if (stay) {
    byId("stay-dialog-title").textContent = "Edit stay";
    form.elements.stayId.value = stay.id;
    form.elements.headGuest.value = stay.headGuest;
    form.elements.guestCount.value = stay.guestCount;
    form.elements.otherGuests.value = stay.otherGuests || "";
    setItinerarySegments(segmentsForStay(stay));
    if (stay.documentUrl) {
      form.elements.documentUrl.value = stay.documentUrl;
      byId("existing-document-hint").textContent = "Drive link saved with this stay.";
      byId("open-document-link").href = stay.documentUrl;
      byId("open-document-link").classList.remove("hidden");
    }
    if (stay.documentId) {
      byId("existing-document-hint").textContent += stay.documentName
        ? ` Older browser-stored document: ${stay.documentName}; no Drive link is saved.`
        : " An older browser-stored document has no Drive link.";
    }
    byId("delete-stay-button").classList.remove("hidden");
  } else {
    byId("stay-dialog-title").textContent = "Add a stay";
    form.elements.stayId.value = "";
    if (roomId) setItinerarySegments([{ roomId }]);
  }
  stayDialog.showModal();
  form.elements.headGuest.focus();
}

function stayConflict(roomId, checkIn, checkOut, exceptId) {
  return roomAssignments().find((assignment) => {
    if (assignment.roomId !== roomId || assignment.stayId === exceptId) return false;
    const existingStart = localDateTime(assignment.checkInDate, assignment.checkInTime);
    const existingEnd = localDateTime(assignment.checkOutDate, assignment.checkOutTime);
    return checkIn < existingEnd && checkOut > existingStart;
  });
}

byId("add-stay-button").addEventListener("click", () => {
  if (state.data.rooms.length === 0) {
    showToast("Add a room before creating a stay.");
    openRoomDialog();
    return;
  }
  openStayDialog();
});
byId("add-room-button").addEventListener("click", () => openRoomDialog(state.selectedHotel === "all" ? "" : state.selectedHotel));
byId("data-info-button").addEventListener("click", () => {
  showToast(isCloudApp
    ? "Bookings and Drive links are shared through your Google Sheet. Documents stay in your Google Drive."
    : "Bookings and Drive links are stored only in this browser. Documents stay in your Google Drive.");
});
byId("startup-retry")?.addEventListener("click", () => {
  byId("startup-error").textContent = "";
  byId("startup-retry").classList.add("hidden");
  initializeSharedData();
});
byId("all-rooms-tab").addEventListener("click", () => {
  state.overviewTab = "all";
  renderDashboard();
  renderHotels();
});
byId("today-tab").addEventListener("click", () => {
  state.overviewTab = "today";
  renderDashboard();
  renderHotels();
});
byId("guest-search").addEventListener("input", (event) => {
  state.searchQuery = event.currentTarget.value;
  renderHotels();
});

byId("room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const hotelId = form.elements.hotelId.value;
  const roomNumber = form.elements.roomNumber.value.trim();
  const availableFrom = form.elements.availableFrom.value;
  const error = byId("room-error");
  if (!roomNumber) {
    error.textContent = "Enter a room number.";
    return;
  }
  if (state.data.rooms.some((room) => room.hotelId === hotelId && room.roomNumber.toLowerCase() === roomNumber.toLowerCase())) {
    error.textContent = "That room number already exists at this hotel.";
    return;
  }
  state.data.rooms.push({
    id: makeId("room"), hotelId, roomNumber, isExtra: form.elements.isExtra.checked,
    availableFrom
  });
  if (!await saveData()) return;
  roomDialog.close();
  render();
  showToast(`Room ${roomNumber} added.`);
});

byId("add-segment-button").addEventListener("click", () => addItinerarySegment());
byId("stay-segments").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-segment");
  if (!removeButton) return;
  removeButton.closest("[data-itinerary-segment]").remove();
  byId("stay-segments").querySelectorAll("[data-itinerary-segment]").forEach((segment, index) => {
    segment.querySelector(".itinerary-segment-header strong").textContent = `Stay ${index + 1}`;
    const remove = segment.querySelector(".remove-segment");
    if (index === 0 && remove) remove.remove();
    else if (index > 0 && !remove) {
      const button = document.createElement("button");
      button.className = "text-button remove-segment";
      button.type = "button";
      button.textContent = "Remove";
      segment.querySelector(".itinerary-segment-header").append(button);
    }
  });
});
byId("stay-segments").addEventListener("change", (event) => {
  if (!event.target.matches('[data-segment-field="hotelId"]')) return;
  updateSegmentRoomOptions(event.target.closest("[data-itinerary-segment]"));
});

function parseRoomNumbers(value) {
  const roomNumbers = new Map();
  value.split(/[\n,;]/).map((roomNumber) => roomNumber.trim()).filter(Boolean).forEach((roomNumber) => {
    const key = roomNumber.toLocaleLowerCase();
    if (!roomNumbers.has(key)) roomNumbers.set(key, roomNumber);
  });
  return [...roomNumbers.values()];
}

function updateBulkCount() {
  const count = parseRoomNumbers(byId("bulk-room-numbers").value).length;
  byId("bulk-count").textContent = `${count} ${count === 1 ? "room number" : "room numbers"} entered`;
}

byId("bulk-room-numbers").addEventListener("input", updateBulkCount);
byId("bulk-room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const hotelId = form.elements.hotelId.value;
  const availableFrom = form.elements.availableFrom.value;
  const roomNumbers = parseRoomNumbers(form.elements.roomNumbers.value);
  const error = byId("bulk-error");
  const result = byId("bulk-result");
  error.textContent = "";
  result.textContent = "";

  if (!hotelById(hotelId)) {
    error.textContent = "Select a hotel.";
    return;
  }
  if (roomNumbers.length === 0) {
    error.textContent = "Enter at least one room number.";
    return;
  }
  if (roomNumbers.length > 500) {
    error.textContent = "Add no more than 500 unique room numbers per batch.";
    return;
  }

  const existingRoomNumbers = new Set(state.data.rooms
    .filter((room) => room.hotelId === hotelId)
    .map((room) => room.roomNumber.toLowerCase()));
  const newRoomNumbers = roomNumbers.filter((roomNumber) => !existingRoomNumbers.has(roomNumber.toLowerCase()));
  const skippedCount = roomNumbers.length - newRoomNumbers.length;

  if (newRoomNumbers.length === 0) {
    result.textContent = `No new rooms added. All ${roomNumbers.length} room numbers already exist in this hotel.`;
    return;
  }

  const addedRooms = newRoomNumbers.map((roomNumber) => ({
    id: makeId("room"),
    hotelId,
    roomNumber,
    isExtra: false,
    availableFrom
  }));
  state.data.rooms.push(...addedRooms);
  if (!await saveData()) {
    const addedIds = new Set(addedRooms.map((room) => room.id));
    state.data.rooms = state.data.rooms.filter((room) => !addedIds.has(room.id));
    return;
  }

  render();
  const skippedMessage = skippedCount ? ` Skipped ${skippedCount} duplicate ${skippedCount === 1 ? "number" : "numbers"}.` : "";
  result.textContent = `Added ${addedRooms.length} ${addedRooms.length === 1 ? "room" : "rooms"} to ${hotelById(hotelId).name}.${skippedMessage}`;
  showToast(`${addedRooms.length} ${addedRooms.length === 1 ? "room" : "rooms"} added.`);
});

byId("room-data-hotel").addEventListener("change", (event) => {
  state.roomDataHotel = event.currentTarget.value;
  renderRoomManagement();
});
byId("room-data-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = byId("room-data-error");
  error.textContent = "";
  const rows = [...byId("room-data-rows").querySelectorAll("[data-room-row]")];
  if (rows.length === 0) {
    error.textContent = "There are no rooms to update.";
    return;
  }
  const updates = rows.map((row) => {
    const room = roomById(row.dataset.roomRow);
    return {
      room,
      roomNumber: row.querySelector('[name="roomNumber"]').value.trim(),
      availableFrom: row.querySelector('[name="availableFrom"]').value,
      isExtra: row.querySelector('[name="isExtra"]').checked
    };
  });
  if (updates.some((update) => !update.roomNumber)) {
    error.textContent = "Every room must have a room number.";
    return;
  }

  const roomNumbers = new Set();
  for (const update of updates) {
    const key = `${update.room.hotelId}|${update.roomNumber.toLocaleLowerCase()}`;
    if (roomNumbers.has(key)) {
      error.textContent = `Room ${update.roomNumber} is listed more than once for the same hotel.`;
      return;
    }
    roomNumbers.add(key);
    if (update.availableFrom && roomAssignments().some((assignment) =>
      assignment.roomId === update.room.id && assignment.checkInDate < update.availableFrom
    )) {
      error.textContent = `Room ${update.roomNumber} has a booking before its available-from date.`;
      return;
    }
  }

  const previousRooms = structuredClone(state.data.rooms);
  for (const update of updates) {
    update.room.roomNumber = update.roomNumber;
    update.room.availableFrom = update.availableFrom;
    update.room.isExtra = update.isExtra;
  }
  if (!await saveData()) {
    state.data.rooms = previousRooms;
    render();
    return;
  }
  render();
  showToast("Room data updated.");
});

byId("hotel-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const hotel = hotelById(form.elements.hotelId.value);
  const name = form.elements.hotelName.value.trim();
  if (!hotel || !name) {
    byId("hotel-error").textContent = "Enter a hotel name.";
    return;
  }
  hotel.name = name;
  if (!await saveData()) return;
  hotelDialog.close();
  render();
  showToast("Hotel name updated.");
});

byId("stay-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = byId("stay-error");
  error.textContent = "";
  const stayId = form.elements.stayId.value;
  const segments = [...byId("stay-segments").querySelectorAll("[data-itinerary-segment]")].map((element) => ({
    roomId: element.querySelector('[data-segment-field="roomId"]').value,
    checkInDate: element.querySelector('[data-segment-field="checkInDate"]').value,
    checkInTime: element.querySelector('[data-segment-field="checkInTime"]').value,
    checkOutDate: element.querySelector('[data-segment-field="checkOutDate"]').value,
    checkOutTime: element.querySelector('[data-segment-field="checkOutTime"]').value
  }));
  if (segments.length === 0) {
    error.textContent = "Add at least one room to the itinerary.";
    return;
  }
  for (const [index, segment] of segments.entries()) {
    const assignedRoom = roomById(segment.roomId);
    if (!assignedRoom) {
      error.textContent = `Select a hotel and room for Stay ${index + 1}.`;
      return;
    }
    if (!segment.checkInDate || !segment.checkInTime || !segment.checkOutDate || !segment.checkOutTime) {
      error.textContent = `Complete the dates and times for Stay ${index + 1}.`;
      return;
    }
    const checkIn = localDateTime(segment.checkInDate, segment.checkInTime);
    const checkOut = localDateTime(segment.checkOutDate, segment.checkOutTime);
    if (!(checkOut > checkIn)) {
      error.textContent = `Stay ${index + 1}: check-out must be later than check-in.`;
      return;
    }
    if (!roomAvailableOn(assignedRoom, segment.checkInDate)) {
      error.textContent = `Stay ${index + 1}: this room does not open until ${formatDate(assignedRoom.availableFrom)}.`;
      return;
    }
    if (stayConflict(segment.roomId, checkIn, checkOut, stayId)) {
      error.textContent = `Stay ${index + 1}: this room already has a booking during those dates and times.`;
      return;
    }
    if (index > 0) {
      const previous = segments[index - 1];
      if (checkIn < localDateTime(previous.checkOutDate, previous.checkOutTime)) {
        error.textContent = "Put room changes in date order, with no overlapping stays.";
        return;
      }
    }
  }
  if (segments.length > 30) {
    error.textContent = "A guest itinerary can include up to 30 room changes.";
    return;
  }
  const guestCount = Number(form.elements.guestCount.value);
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 30) {
    error.textContent = "Enter a guest count from 1 to 30.";
    return;
  }
  const headGuest = form.elements.headGuest.value.trim();
  if (!headGuest) {
    error.textContent = "Enter the head guest’s name.";
    return;
  }

  const existing = state.data.stays.find((stay) => stay.id === stayId);
  const documentId = existing?.documentId || "";
  const documentName = existing?.documentName || "";
  const documentUrl = form.elements.documentUrl.value.trim();
  if (documentUrl) {
    try {
      const parsedUrl = new URL(documentUrl);
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password ||
          !["drive.google.com", "docs.google.com"].includes(parsedUrl.hostname)) {
        error.textContent = "Enter a secure Google Drive or Google Docs link.";
        return;
      }
    } catch {
      error.textContent = "Enter a valid Google Drive link.";
      return;
    }
  }
  state.data.stays = state.data.stays.filter((stay) => stay.id !== stayId);
  state.data.stays.push({
    id: stayId || makeId("stay"), headGuest, guestCount,
    otherGuests: form.elements.otherGuests.value.trim(), segments,
    documentId, documentName, documentUrl
  });
  if (!await saveData()) return;
  stayDialog.close();
  render();
  showToast(documentUrl ? "Stay and Drive link saved." : "Stay saved.");
});

byId("delete-stay-button").addEventListener("click", async () => {
  const stayId = byId("stay-form").elements.stayId.value;
  if (!stayId) return;
  state.data.stays = state.data.stays.filter((stay) => stay.id !== stayId);
  if (!await saveData()) return;
  stayDialog.close();
  render();
  showToast("Stay removed.");
});

byId("edit-stay-detail").addEventListener("click", (event) => {
  const stayId = event.currentTarget.dataset.stayId;
  byId("stay-detail-dialog").close();
  openStayDialog("", stayId);
});

document.querySelectorAll(".close-dialog").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

render();
initializeSharedData();

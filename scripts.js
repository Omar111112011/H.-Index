// scripts.js - H.Index Platform Logic (Frontend)
// =============================================
// Version: Final + End Task + Shared Declined/Completed Task Removal + Dynamic Loading Fix

// --- Configuration ---
const DEBUG_MODE = true; // Keep true for debugging
const API_BASE_URL = ''; // Relative path to server (same origin)

// --- WebSocket Instance ---
let socket;
function connectSocket() {
    if (socket && socket.connected) {
        logDebug("Socket already connected.");
        return socket;
    }
    try {
        const token = getAuthToken();
        if (!token) {
            logWarn("No auth token found for socket connection. Connecting unauthenticated.");
             socket = io();
        } else {
            // Pass token in auth object for server-side identification (io.use middleware)
            socket = io({ auth: { token: token } });
        }

        socket.on('connect', () => {
            logDebug('Socket connected. ID:', socket.id);
            // Re-join necessary rooms upon connection/reconnection
            const user = getLoggedInUser();
            if (user) {
                joinUserRoom(user); // Join general user room
                // If on chat page, rejoin chat room (handled in chat page logic)
            }
        });
        socket.on('connect_error', (err) => {
            logError("Socket connection error:", err.message);
            // Handle connection errors (e.g., show message to user)
            displayGlobalStatus("Connection Error: Could not connect to real-time server.", true, 0);
        });
        socket.on('disconnect', (reason) => {
            logWarn("Socket disconnected:", reason);
             displayGlobalStatus(`Disconnected: ${reason}. Attempting to reconnect...`, true, 0);
            // Socket.IO automatically tries to reconnect
        });
        socket.on('reconnect', (attemptNumber) => {
            logDebug(`Socket reconnected after ${attemptNumber} attempts.`);
            hideGlobalStatus();
        });
         socket.on('reconnect_failed', () => {
            logError("Socket reconnection failed permanently.");
             displayGlobalStatus("Reconnection failed. Please refresh the page.", true, 0);
        });

        // Centralized task update listener (for dashboards)
        socket.off('task-update'); // Remove previous listener if any
        socket.on('task-update', handleTaskUpdate);

        return socket;

    } catch (e) {
        logError("Socket.IO connection failed to initialize.", e);
        displayGlobalStatus("Real-time features unavailable.", true, 0);
        socket = null;
        return null;
    }
}

// --- Utility Functions ---
function logDebug(m, ...p) { if (DEBUG_MODE) console.log(`[DEBUG] ${m}`, ...p); }
function logError(m, ...p) { console.error(`[ERROR] ${m}`, ...p); }
function logWarn(m, ...p) { console.warn(`[WARN] ${m}`, ...p); }

function getLoggedInUser() {
    try {
        const userJson = localStorage.getItem('loggedInUser');
        const user = userJson ? JSON.parse(userJson) : null;
        // Add extra check for essential fields
        if (user && user.id && user.email && user.role) {
            return user;
        } else if (userJson) {
             logError("Invalid user data structure in localStorage:", user);
             localStorage.removeItem('loggedInUser');
             localStorage.removeItem('authToken');
             return null;
        } else {
            return null;
        }
    } catch (e) {
        logError("Error parsing loggedInUser from localStorage:", e);
        localStorage.removeItem('loggedInUser'); // Clear invalid data
        localStorage.removeItem('authToken');
        return null;
    }
}
function getAuthToken() { return localStorage.getItem('authToken'); }

function logout() {
    logDebug("logout() called");
    localStorage.removeItem('loggedInUser');
    localStorage.removeItem('authToken');
    if (socket && socket.connected) {
        socket.disconnect();
        logDebug("Socket disconnected on logout.");
    }
    alert('You have been logged out.');
    window.location.href = 'login.html';
}

// Displays a status message within a specific container
function displayStatusMessage(containerId, message, isError = false, duration = 5000) {
     const container = document.getElementById(containerId);
    if (!container) {
         logWarn(`displayStatusMessage: Container ID "${containerId}" not found.`);
         return;
    }
    let statusEl = container.querySelector('.status-message-area');
    if (!statusEl) {
        statusEl = document.createElement('div');
        // Added explicit class for easier selection + Tailwind styling
        statusEl.className = 'status-message-area text-center font-medium p-2 my-2 rounded';
        // Insert near the top, but potentially after a heading
        container.insertBefore(statusEl, container.firstChild?.nextSibling || container.firstChild);
    }

    statusEl.textContent = message;
    statusEl.style.color = 'white';
    statusEl.style.backgroundColor = isError ? '#dc2626' : '#16a34a'; // Red-600 or Green-600
    statusEl.style.display = 'block';
    statusEl.style.opacity = 1;
    statusEl.style.transition = 'opacity 0.5s ease-out';

    if (duration > 0) {
        setTimeout(() => {
            statusEl.style.opacity = 0;
             // Optional: remove element after fade out
             setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 500);
        }, duration);
    }
}

// For global messages (e.g., socket connection status)
let globalStatusElement = null;
function displayGlobalStatus(message, isError = false, duration = 5000) {
      if (!globalStatusElement) {
        globalStatusElement = document.createElement('div');
        globalStatusElement.id = 'global-status-message';
        globalStatusElement.style.position = 'fixed';
        globalStatusElement.style.bottom = '10px';
        globalStatusElement.style.left = '10px';
        globalStatusElement.style.padding = '10px 20px';
        globalStatusElement.style.borderRadius = '6px';
        globalStatusElement.style.zIndex = '1000';
        globalStatusElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        globalStatusElement.style.transition = 'opacity 0.5s ease, transform 0.3s ease';
        globalStatusElement.style.opacity = '0';
        globalStatusElement.style.transform = 'translateY(10px)';
        document.body.appendChild(globalStatusElement);
    }
    globalStatusElement.textContent = message;
    globalStatusElement.style.color = 'white';
    globalStatusElement.style.backgroundColor = isError ? '#ef4444' : '#22c55e'; // Red-500 or Green-500
    globalStatusElement.style.display = 'block';

    requestAnimationFrame(() => {
         globalStatusElement.style.opacity = '1';
         globalStatusElement.style.transform = 'translateY(0)';
    });

    if (duration > 0) {
        setTimeout(hideGlobalStatus, duration);
    }
}

function hideGlobalStatus() {
       if (globalStatusElement) {
         globalStatusElement.style.opacity = '0';
         globalStatusElement.style.transform = 'translateY(10px)';
         setTimeout(() => {
            if (globalStatusElement) globalStatusElement.style.display = 'none';
         }, 500);
    }
}


// --- API Helper ---
async function makeApiRequest(url, method = 'GET', body = null, token = null) {
    const headers = {
        'Content-Type': 'application/json',
    };
    const authToken = token || getAuthToken();
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    } else {
        logWarn(`API Request (${method} ${url}): No auth token found or provided.`);
    }
    const config = {
        method: method,
        headers: headers,
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) { // Added DELETE
        config.body = JSON.stringify(body);
    }
    logDebug(`API Request Start: ${method} ${url}`, body ? `Body: ${JSON.stringify(body)}` : 'No Body', `Token Sent: ${!!authToken}`);

    try {
        const response = await fetch(`${API_BASE_URL}${url}`, config);
        let responseData = {};
        try {
             // Handle potential empty body for DELETE 200/204
             if (response.status === 204 || (response.headers.get('content-length') === '0' && method === 'DELETE')) {
                responseData = { message: 'Operation successful (No Content)' }; // Provide default success message
             } else {
                responseData = await response.json();
             }
        } catch (jsonError) {
            // Handle cases where response is not valid JSON (e.g., empty response, HTML error page)
            logError(`API Response (${method} ${url}): Failed to parse JSON. Status: ${response.status}`, jsonError);
            responseData = { message: `Received non-JSON response from server (Status: ${response.status})` };
             // If status is OK but parsing failed, it's still an issue.
             if (response.ok && method !== 'DELETE') { // Allow empty OK for delete
                throw new Error(responseData.message); // Or handle differently
             }
        }

        logDebug(`API Response Received: ${response.status} ${url}`, `Data: ${JSON.stringify(responseData)}`);

        if (!response.ok) {
            // Check for specific auth errors to trigger logout
            if (response.status === 401 || response.status === 403) {
                 const message = responseData.message || 'Authentication failed.';
                 // More specific check for token-related issues
                 if (message.toLowerCase().includes('token') || message.toLowerCase().includes('auth')) {
                    console.warn(`Authentication error (${response.status}) on ${url}. Logging out.`);
                    alert(message + " Please log in again.");
                    // Use setTimeout to allow alert to display before redirect
                    setTimeout(logout, 50);
                 } else {
                     // General 401/403 might be role related, don't necessarily log out
                     console.warn(`Authorization error (${response.status}) on ${url}: ${message}`);
                 }
            }
             // Throw an error with the message from the response body or a default
             throw new Error(responseData.message || `Request failed with status ${response.status}`);
        }

        return responseData; // Return parsed JSON data on success (status 2xx)

    } catch (error) {
        // Catch network errors (fetch failure) or errors thrown from non-ok responses
        logError(`API Request Failed (${method} ${url}):`, error.message);
        // Ensure the error message is passed along
        throw new Error(error.message || 'Network error or failed request.');
    }
}

// --- WebSocket Helpers ---
function joinUserRoom(user) {
     if (!socket || !socket.connected || !user || !user.id) {
        logWarn("Cannot join user room: Socket not ready or missing user info.");
        return;
     }
    const eventName = user.role === 'client' ? 'join-client-room' : 'join-freelancer-room';
    socket.emit(eventName, user.id);
    logDebug(`Socket: Emitted ${eventName} for user ${user.id}`);
}

// --- Task Rendering ---
function renderTaskItem(task, currentUserRole) {
     const item = document.createElement('div');
    item.className = 'bg-white p-4 rounded-lg shadow mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 task-item';
    item.id = `task-${task.id}`;
    const statusColors = { pending: 'text-yellow-600 bg-yellow-100 border-yellow-300', accepted: 'text-green-700 bg-green-100 border-green-300', declined: 'text-red-700 bg-red-100 border-red-300', completed: 'text-blue-700 bg-blue-100 border-blue-300', };
    const statusColor = statusColors[task.status] || 'text-gray-700 bg-gray-100 border-gray-300';
    const requestDate = task.timestamp ? new Date(task.timestamp).toLocaleDateString() : 'N/A';
    const acceptedDate = task.acceptedAt ? new Date(task.acceptedAt).toLocaleDateString() : '';
    let participantInfo = '';
     if (currentUserRole === 'freelancer') { participantInfo = `Client: ${task.client?.name || 'Unknown'} (${task.client?.email || 'N/A'})`; }
     else if (currentUserRole === 'client') { if (task.freelancer) { participantInfo = `Freelancer: ${task.freelancer.name || 'Unknown'} (${task.freelancer.email || 'N/A'})`; } else { participantInfo = 'Freelancer: <span class="italic text-gray-500">Pending Assignment</span>'; } }
    let detailsHtml = ` <div class="flex-grow mb-3 md:mb-0"> <p class="font-bold text-lg text-gray-800">${task.service || 'N/A'}</p> <p class="text-sm text-gray-600">${participantInfo}</p> <p class="text-xs text-gray-500 mt-1">Requested: ${requestDate}${acceptedDate ? ` | Accepted: ${acceptedDate}` : ''}</p> </div> <div class="flex flex-col md:flex-row items-start md:items-center gap-2 flex-shrink-0"> <span class="task-status-badge inline-block px-3 py-1 text-sm font-medium rounded-full border ${statusColor}"> ${task.status.charAt(0).toUpperCase() + task.status.slice(1)} </span> <div class="task-actions flex gap-2 mt-2 md:mt-0"> ${generateActionButtons(task, currentUserRole)} </div> </div> `;
    item.innerHTML = detailsHtml;
    return item;
}

function generateActionButtons(task, currentUserRole) {
    let buttons = '';
    // Shared Remove Button HTML (for declined/completed)
    const removeButtonHtml = `<button data-task-id="${task.id}" class="remove-button px-3 py-1 bg-red-100 text-red-700 border border-red-300 rounded hover:bg-red-200 text-xs font-medium transition duration-150 ease-in-out" title="Remove task history"><i class="fas fa-trash-alt mr-1"></i>Remove</button>`;
    // Freelancer "End Task" Button HTML
    const completeButtonHtml = `<button data-task-id="${task.id}" class="complete-button px-3 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm transition duration-150 ease-in-out" title="Mark task as complete">End Task</button>`;

    // --- Freelancer Buttons ---
    if (currentUserRole === 'freelancer') {
        if (task.status === 'pending') {
            buttons += `<button data-task-id="${task.id}" class="accept-button px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm transition duration-150 ease-in-out">Accept</button>`;
            buttons += `<button data-task-id="${task.id}" class="decline-button px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm transition duration-150 ease-in-out">Decline</button>`;
        } else if (task.status === 'accepted') {
            buttons += `<button onclick="startChat('${task.id}')" class="chat-button px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm mr-2 transition duration-150 ease-in-out">Chat</button>`;
            buttons += completeButtonHtml;
        } else if (task.status === 'declined') {
            buttons += `<span class="text-gray-500 text-sm italic mr-2">Declined</span>`;
            buttons += removeButtonHtml;
        } else if (task.status === 'completed') {
             buttons += `<button onclick="startChat('${task.id}')" class="chat-button px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm mr-2 transition duration-150 ease-in-out">View Chat</button>`;
             buttons += removeButtonHtml;
        }
    }
    // --- Client Buttons ---
    else if (currentUserRole === 'client') {
        if (task.status === 'accepted') {
             buttons += `<button onclick="startChat('${task.id}')" class="chat-button px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm transition duration-150 ease-in-out">Join Chat</button>`;
        } else if (task.status === 'pending') {
             buttons += `<span class="text-gray-500 text-sm italic">Awaiting acceptance...</span>`;
        } else if (task.status === 'declined') {
             buttons += `<span class="text-gray-500 text-sm italic mr-2">Request Declined</span>`;
             buttons += removeButtonHtml;
        } else if (task.status === 'completed') {
             buttons += `<button onclick="startChat('${task.id}')" class="chat-button px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm mr-2 transition duration-150 ease-in-out">View Chat</button>`;
             buttons += removeButtonHtml;
        }
    }
    return buttons;
}

// Handles task updates received via WebSocket
function handleTaskUpdate(update) {
    logDebug("WebSocket received task-update:", update);
    const taskElement = document.getElementById(`task-${update.taskId}`);

    if (taskElement) {
        logDebug(`Updating task ${update.taskId} UI on dashboard.`);
        const currentUser = getLoggedInUser();
        if (currentUser) {
             fetchTaskAndRerender(update.taskId, currentUser.role);
        } else { /* ... fallback UI update ... */ }
         taskElement.style.transition = 'background-color 0.5s ease';
         taskElement.style.backgroundColor = '#fef3c7';
         setTimeout(() => { if(taskElement) taskElement.style.backgroundColor = 'white'; }, 1000);

    } else {
        logDebug(`Task ${update.taskId} updated but not visible on current dashboard view.`);
        const message = `Task "${update.service || 'request'}" status changed to ${update.status}.`;
        displayGlobalStatus(message, false, 7000);
         const pathname = window.location.pathname;
         const currentUser = getLoggedInUser();
          if (currentUser &&
             ((pathname.includes('client-dashboard.html') && currentUser.role === 'client') ||
              (pathname.includes('freelancer-dashboard.html') && currentUser.role === 'freelancer')))
          {
            logDebug("Task updated off-screen, triggering list refresh.");
            setTimeout(fetchAndRenderTasks, 500);
         }
    }

     const currentUser = getLoggedInUser();
     if (currentUser?.role === 'client' && (update.status === 'accepted' || update.status === 'declined' || update.status === 'completed')) {
           alert(`Update for your request "${update.service || ''}": Status is now ${update.status}.` +
                 (update.status === 'accepted' ? ` Freelancer: ${update.freelancerName || 'Assigned'}` : ''));
     }
}

// Helper to fetch single task and replace its element
async function fetchTaskAndRerender(taskId, currentUserRole) {
      try {
        const token = getAuthToken();
        const task = await makeApiRequest(`/api/tasks/${taskId}/details`, 'GET', null, token);
        const oldElement = document.getElementById(`task-${taskId}`);
        if (oldElement && task) {
            const taskDataForRender = { id: task.id, service: task.service, client: task.client, freelancer: task.freelancer, timestamp: task.timestamp, status: task.status, acceptedAt: task.acceptedAt };
            const newElement = renderTaskItem(taskDataForRender, currentUserRole);
            oldElement.parentNode.replaceChild(newElement, oldElement);
            logDebug(`Refreshed UI for task ${taskId}`);
        } else if (oldElement) {
             logWarn(`Task ${taskId} element found, but failed to fetch updated details.`);
             oldElement.style.opacity = '0.5';
             oldElement.innerHTML += `<p class="text-xs text-red-500">Failed to refresh</p>`;
        }
     } catch (error) {
        logError(`Failed to fetch and rerender task ${taskId}:`, error);
         const oldElement = document.getElementById(`task-${taskId}`);
          if (oldElement) {
               oldElement.style.border = '1px solid red';
               const errorP = document.createElement('p');
               errorP.className = 'text-xs text-red-500 mt-1';
               errorP.textContent = 'Update failed';
               oldElement.querySelector('.task-actions')?.appendChild(errorP);
          }
     }
}


// --- Dashboard Specific Functions ---
async function sendNotification(service) { logDebug(`--- Starting sendNotification for service: ${service} ---`); const user = getLoggedInUser(); const token = getAuthToken(); const statusContainerId = 'clientDashboardStatus'; const statusContainer = document.getElementById(statusContainerId); if (!user || !token) { logError('sendNotification Error: Missing user data or token.'); alert("Authentication error. Please log in again."); logout(); return; } if (user.role !== 'client') { logError(`sendNotification Error: User ${user.email} has role '${user.role}', expected 'client'.`); alert("Access denied. Only clients can request services."); logout(); return; } logDebug(`User verified: ${user.email}, Role: ${user.role}, Token present: ${!!token}`); const serviceButtons = document.querySelectorAll('.service-button'); serviceButtons.forEach(b => b.disabled = true); if (statusContainer) { displayStatusMessage(statusContainerId, `Submitting request for ${service}...`, false, 0); } else { logWarn(`Status container #${statusContainerId} not found!`); } try { logDebug(`Calling makeApiRequest for /api/tasks/request with service: ${service}`); const result = await makeApiRequest('/api/tasks/request', 'POST', { service: service }, token); logDebug('Client: Service request API call successful:', result); if (statusContainer) { displayStatusMessage(statusContainerId, `Request for "${service}" submitted successfully!`, false, 5000); } alert(`Request for "${service}" submitted!`); logDebug("Triggering task list refresh after successful request."); setTimeout(fetchAndRenderTasks, 300); } catch (error) { logError(`Client: Service request API call failed for "${service}":`, error); const errorMessage = error.message || 'An unknown error occurred.'; if (statusContainer) { displayStatusMessage(statusContainerId, `Error submitting request: ${errorMessage}`, true, 8000); } alert(`Failed to submit request for "${service}": ${errorMessage}`); } finally { logDebug("Re-enabling service buttons."); serviceButtons.forEach(b => b.disabled = false); logDebug(`--- Finished sendNotification for service: ${service} ---`); } }
async function handleTaskAction(taskId, action, buttonEl) { logDebug(`Freelancer: Handling action "${action}" for task ${taskId}`); const token = getAuthToken(); if (!token) { alert("Authentication error. Please log in again."); logout(); return; } const taskItem = buttonEl.closest('.task-item'); const actionButtons = taskItem ? taskItem.querySelectorAll('.task-actions button') : []; actionButtons.forEach(btn => btn.disabled = true); buttonEl.textContent = action === 'accept' ? 'Accepting...' : 'Declining...'; buttonEl.insertAdjacentHTML('afterbegin', '<i class="fas fa-spinner fa-spin mr-1 text-xs"></i>'); try { const result = await makeApiRequest(`/api/tasks/${taskId}/${action}`, 'PUT', null, token); logDebug(`Freelancer: Action ${action} success for task ${taskId}:`, result); const spinner = buttonEl.querySelector('.fa-spinner'); if (spinner) spinner.remove(); if (action === 'accept' && result.task) { logDebug(`Redirecting to chat for accepted task: ${taskId}`); alert(`Task accepted. Redirecting to chat...`); startChat(taskId); return; } alert(`Task successfully ${action}ed.`); if (result.task) { const currentUser = getLoggedInUser(); const updatedElement = renderTaskItem(result.task, currentUser.role); if (taskItem && taskItem.parentNode) { taskItem.parentNode.replaceChild(updatedElement, taskItem); logDebug(`Replaced task item ${taskId} with updated version.`); } else { logWarn(`Could not replace task item ${taskId} in DOM. Refreshing list.`); fetchAndRenderTasks(); } } else { logWarn(`Action ${action} successful, but no task data returned. Refreshing list.`); fetchAndRenderTasks(); } } catch (error) { logError(`Freelancer: Action ${action} error for task ${taskId}:`, error); const spinner = buttonEl.querySelector('.fa-spinner'); if (spinner) spinner.remove(); alert(`Error ${action}ing task: ${error.message}`); actionButtons.forEach(btn => btn.disabled = false); buttonEl.textContent = action === 'accept' ? 'Accept' : 'Decline'; } }
async function handleRemoveTask(taskId, buttonEl) { logDebug(`Handling remove action for task ${taskId}`); const confirmed = confirm("Are you sure you want to permanently remove this task and its chat history? This action cannot be undone."); if (!confirmed) { logDebug("Task removal cancelled by user."); return; } const taskItem = buttonEl.closest('.task-item'); const actionButtons = taskItem ? taskItem.querySelectorAll('.task-actions button') : []; actionButtons.forEach(btn => btn.disabled = true); buttonEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1 text-xs"></i>Removing...'; try { const result = await makeApiRequest(`/api/tasks/${taskId}`, 'DELETE'); logDebug(`Remove task API call successful for ${taskId}:`, result); if (taskItem) { taskItem.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out'; taskItem.style.opacity = '0'; taskItem.style.transform = 'scale(0.95)'; setTimeout(() => { taskItem.remove(); logDebug(`Removed task item ${taskId} from UI.`); const listContainer = document.getElementById('taskListContainer'); if (listContainer && !listContainer.querySelector('.task-item')) { listContainer.innerHTML = `<p class="text-center text-gray-500 italic py-6">No tasks found.</p>`; } }, 500); } displayGlobalStatus(result.message || 'Task removed successfully.', false, 5000); } catch (error) { logError(`Remove task API call failed for ${taskId}:`, error); alert(`Failed to remove task: ${error.message}`); displayGlobalStatus(`Error removing task: ${error.message}`, true, 8000); actionButtons.forEach(btn => btn.disabled = false); buttonEl.innerHTML = '<i class="fas fa-trash-alt mr-1"></i>Remove'; } }
async function handleCompleteTask(taskId, buttonEl) { logDebug(`Freelancer: Handling complete action for task ${taskId}`); const confirmed = confirm("Are you sure you want to mark this task as complete? The client will be notified."); if (!confirmed) { logDebug("Task completion cancelled by user."); return; } const taskItem = buttonEl.closest('.task-item'); const actionButtons = taskItem ? taskItem.querySelectorAll('.task-actions button') : []; actionButtons.forEach(btn => btn.disabled = true); buttonEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1 text-xs"></i>Ending...'; try { const result = await makeApiRequest(`/api/tasks/${taskId}/complete`, 'PUT'); logDebug(`Freelancer: Complete task API call successful for ${taskId}:`, result); const spinner = buttonEl.querySelector('.fa-spinner'); if (spinner) spinner.remove(); buttonEl.textContent = 'End Task'; alert(result.message || 'Task marked as complete.'); /* Rely on WebSocket update for UI change */ } catch (error) { logError(`Freelancer: Complete task API call failed for ${taskId}:`, error); alert(`Failed to mark task as complete: ${error.message}`); displayGlobalStatus(`Error completing task: ${error.message}`, true, 8000); const spinner = buttonEl.querySelector('.fa-spinner'); if (spinner) spinner.remove(); actionButtons.forEach(btn => btn.disabled = false); buttonEl.innerHTML = 'End Task'; } }


// --- Dashboard Setup & Event Listeners ---
function setupClientDashboard(user) { logDebug("Setting up Client Dashboard..."); const welcomeMsgEl = document.getElementById('welcomeMsg'); if (welcomeMsgEl) { welcomeMsgEl.textContent = `Welcome, ${user.name || user.email}!`; } fetchAndRenderTasks(); attachClientTaskActionListeners(); }
function attachClientTaskActionListeners() { logDebug("Attaching client task action listeners."); const listDiv = document.getElementById("taskListContainer"); if (listDiv) { if (listDiv.dataset.clientListenersAttached === 'true') { return; } listDiv.removeEventListener('click', handleClientTaskActions); listDiv.addEventListener('click', handleClientTaskActions); listDiv.dataset.clientListenersAttached = 'true'; } else { logError("Cannot attach client listeners: Task list container not found."); } }
function handleClientTaskActions(e) { const targetButton = e.target.closest('button[data-task-id]'); if (!targetButton) return; const taskId = targetButton.dataset.taskId; if (!taskId || targetButton.disabled) return; if (targetButton.matches('.remove-button')) { handleRemoveTask(taskId, targetButton); } }
function setupFreelancerDashboard(user) { logDebug("Setting up Freelancer Dashboard..."); const welcomeMsgEl = document.getElementById('welcomeMsg'); if (welcomeMsgEl) { welcomeMsgEl.textContent = `Welcome, ${user.name || user.email}!`; } const listDiv = document.getElementById("taskListContainer"); if(listDiv) listDiv.dataset.listenersAttached = 'false'; fetchAndRenderTasks(); }
function setupFreelancerActionListeners() { logDebug("Setting up freelancer action listeners for task list."); const listDiv = document.getElementById("taskListContainer"); if (!listDiv) { logError("Cannot setup freelancer listeners: Task list container not found."); return; } if (listDiv.dataset.listenersAttached === 'true') { logDebug("Freelancer listeners already attached."); return; } listDiv.addEventListener('click', handleFreelancerTaskActions); listDiv.dataset.listenersAttached = 'true'; }
function handleFreelancerTaskActions(e) { const targetButton = e.target.closest('button[data-task-id]'); if (!targetButton) return; const taskId = targetButton.dataset.taskId; if (!taskId || targetButton.disabled) return; logDebug(`Freelancer Action clicked: TaskID=${taskId}, ClassList=${targetButton.className}`); if (targetButton.matches('.accept-button')) { handleTaskAction(taskId, 'accept', targetButton); } else if (targetButton.matches('.decline-button')) { handleTaskAction(taskId, 'decline', targetButton); } else if (targetButton.matches('.remove-button')) { handleRemoveTask(taskId, targetButton); } else if (targetButton.matches('.complete-button')) { handleCompleteTask(taskId, targetButton); } }


// --- Generic Task Fetching and Rendering (Dynamic Loader Version) ---
async function fetchAndRenderTasks() {
    const user = getLoggedInUser();
    if (!user) {
        logWarn("fetchAndRenderTasks called without logged-in user.");
        const listDiv = document.getElementById("taskListContainer");
        if(listDiv) listDiv.innerHTML = '<p class="text-center text-red-500 p-4">Please log in to view tasks.</p>';
        return;
    }

    const listDiv = document.getElementById("taskListContainer");
    const statusContainerId = user.role === 'client' ? 'clientDashboardStatus' : 'freelancerDashboardStatus';
    const statusContainer = document.getElementById(statusContainerId);

    if (!listDiv) { // Only need to check for the main container
        logError("fetchAndRenderTasks Error: Task list container (#taskListContainer) element not found!");
        if(statusContainer) displayStatusMessage(statusContainerId, "UI Error: Task list container missing.", true, 0);
        return;
    }

    logDebug(`Fetching tasks for ${user.role} ${user.email}`);

    // --- DYNAMIC LOADING INDICATOR ---
    const loadingHTML = ` <div id="tasksLoadingDynamic" class="text-center py-6"> <i class="fas fa-spinner fa-spin text-2xl text-gray-500"></i> <p class="mt-2 text-gray-500">Loading tasks...</p> </div> `;
    listDiv.innerHTML = loadingHTML; // Set the loading indicator
    logDebug("Dynamic loading indicator added.");
    // --- End Dynamic Loading Indicator ---

    try {
        const tasks = await makeApiRequest('/api/tasks/my-tasks', 'GET');
        logDebug(`Received ${tasks.length} tasks.`);

        listDiv.innerHTML = ''; // Clear the loader before processing/rendering
        logDebug("Loading indicator cleared.");

        if (!tasks || !Array.isArray(tasks)) { logError("API response for /my-tasks was not a valid array:", tasks); throw new Error("Received invalid data from server."); }

        if (tasks.length === 0) {
            listDiv.innerHTML = `<p class="text-center text-gray-500 italic py-6">No tasks found.</p>`;
        } else {
            tasks.forEach(task => {
                try {
                    if (!task || !task.id || !task.status) { logWarn("Skipping invalid task structure during rendering:", task); return; }
                    const taskElement = renderTaskItem(task, user.role);
                    listDiv.appendChild(taskElement);
                } catch(renderError) {
                     logError(`Error rendering task item (ID: ${task?.id}):`, renderError);
                     const errorItem = document.createElement('div');
                     errorItem.className = 'p-4 mb-4 border border-red-300 bg-red-50 rounded-lg text-red-700';
                     errorItem.textContent = `Error displaying task (ID: ${task?.id || 'unknown'}).`;
                     listDiv.appendChild(errorItem);
                }
            });
            if (user.role === 'freelancer') { setupFreelancerActionListeners(); }
            if (user.role === 'client') { attachClientTaskActionListeners(); }
        }
        logDebug("Task rendering complete.");

    } catch (error) {
        logError("Error during fetchAndRenderTasks:", error);
        // Ensure loading indicator is cleared in CATCH block too
        const currentLoadingEl = listDiv.querySelector('#tasksLoadingDynamic');
        if(currentLoadingEl) { listDiv.innerHTML = ''; logDebug("Loading indicator cleared after error."); }
        else { listDiv.innerHTML = ''; logDebug("List cleared after error during/after rendering.");}

        listDiv.innerHTML = `<p class="text-center text-red-600 p-4">Error loading tasks: ${error.message}. Please try refreshing.</p>`;
        if(statusContainer) displayStatusMessage(statusContainerId, `Failed to load tasks: ${error.message}`, true, 0);
    }
}


// --- Navigation ---
function startChat(taskId) { logDebug(`Redirecting to chat page for task: ${taskId}`); window.location.href = `live-chat.html?taskId=${taskId}`; }

// --- Initialization ---
function initializePage() { logDebug("DOM loaded. Initializing page..."); const user = getLoggedInUser(); const pathname = window.location.pathname; if (!socket || !socket.connected) { socket = connectSocket(); } if (!user) { if (!pathname.includes('login.html') && !pathname.includes('register.html') && pathname !== '/' && !pathname.includes('index.html')) { logWarn("User not logged in. Redirecting to login."); alert("Please log in to access this page."); setTimeout(() => { window.location.href = 'login.html'; }, 50); return; } logDebug("User not logged in, on public page."); return; } else { if (pathname.includes('login.html') || pathname.includes('register.html')) { logWarn("User already logged in. Redirecting to dashboard."); const dashboardUrl = user.role === 'client' ? 'client-dashboard.html' : 'freelancer-dashboard.html'; setTimeout(() => { window.location.href = dashboardUrl; }, 50); return; } if (pathname.includes('client-dashboard.html') && user.role !== 'client') { logWarn(`Incorrect dashboard access. Role: ${user.role}. Logging out.`); alert("Access Denied. Logging out."); setTimeout(logout, 50); return; } if (pathname.includes('freelancer-dashboard.html') && user.role !== 'freelancer') { logWarn(`Incorrect dashboard access. Role: ${user.role}. Logging out.`); alert("Access Denied. Logging out."); setTimeout(logout, 50); return; } } if (socket) { if (socket.connected) { joinUserRoom(user); } else { socket.once('connect', () => joinUserRoom(user)); } } if (pathname.includes('client-dashboard.html')) { setupClientDashboard(user); } else if (pathname.includes('freelancer-dashboard.html')) { setupFreelancerDashboard(user); } else if (pathname.includes('live-chat.html')) { logDebug("On chat page - initialization handled by chat script."); } else { logDebug("On generic page (e.g., index.html) - no specific setup needed."); } }

// --- Run Initialization on DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', initializePage);
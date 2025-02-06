document.addEventListener('DOMContentLoaded', () => {
    // Initialize flatpickr for all date inputs
    flatpickr('.datepicker', {
        enableTime: false,
        dateFormat: "Y-m-d",
        allowInput: true
    });

    // Configure toastr
    toastr.options = {
        "closeButton": true,
        "progressBar": true,
        "positionClass": "toast-top-right",
        "timeOut": "3000"
    };
    
    // Load connections from localStorage first for instant display
    const storedConnections = localStorage.getItem('connections');
    if (storedConnections) {
        displayConnections(JSON.parse(storedConnections));
    }
    
    // Then fetch fresh data from server
    loadConnections();
});

// Function to load connections from server
async function loadConnections() {
    try {
        // Clear local storage before fetching
        localStorage.removeItem('connections');
        
        const response = await fetch('/api/connections', {
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (response.ok) {
            const connections = await response.json();
            localStorage.setItem('connections', JSON.stringify(connections));
            displayConnections(connections);
            toastr.success('Connections refreshed');
        } else {
            toastr.error('Failed to load connections');
        }
    } catch (error) {
        console.error('Error loading connections:', error);
        toastr.error('Error loading connections');
    }
}

// Function to display connections in the table
function displayConnections(connections) {
    const tbody = document.getElementById('connectionsList');

    if (!connections || !connections.length) {
        tbody.innerHTML = `
            <tr class="border-t">
                <td colspan="8" class="px-4 py-8 text-center text-gray-500">
                    No connections found. Click "Add Connection" to create one.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = connections.map(conn => `
        <tr class="border-t hover:bg-gray-50" data-id="${conn._id}">
            <td class="px-4 py-2">${escapeHtml(conn.name || '')}</td>
            <td class="px-4 py-2">${escapeHtml(conn.targetUrl || '')}</td>
            <td class="px-4 py-2">${escapeHtml(conn.targetUsername || '')}</td>
            <td class="px-4 py-2">${escapeHtml(conn.targetPassword || '')}</td>
            <td class="px-4 py-2">${escapeHtml(conn.iptvUsername || '')}</td>
            <td class="px-4 py-2">${escapeHtml(conn.iptvPassword || '')}</td>
            <td class="px-4 py-2">${conn.expireDate ? escapeHtml(conn.expireDate) : ''}</td>
            <td class="px-4 py-2 whitespace-nowrap">
                <div class="flex space-x-2">
                    <button onclick="editConnection(${JSON.stringify(conn).replace(/"/g, '&quot;')})" 
                            class="text-blue-500 hover:text-blue-700 p-1">Edit</button>
                    <button onclick="deleteConnection('${conn._id}')" 
                            class="text-red-500 hover:text-red-700 p-1">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Function to show add/edit form
function showAddForm() {
    if (!document.getElementById('formTitle').textContent.includes('Edit')) {
        document.getElementById('formTitle').textContent = 'Add IPTV Connection';
        document.getElementById('submitButton').textContent = 'Save';
        document.getElementById('connectionId').value = '';
        document.getElementById('connectionForm').reset();
    }
    document.getElementById('addForm').classList.remove('hidden');
}

// Function to hide form
function hideAddForm() {
    document.getElementById('addForm').classList.add('hidden');
    document.getElementById('connectionForm').reset();
}

// Function to populate edit form
function editConnection(connection) {
    document.getElementById('formTitle').textContent = 'Edit IPTV Connection';
    document.getElementById('submitButton').textContent = 'Update';
    const form = document.getElementById('connectionForm');
    
    form.id.value = connection._id;
    form.name.value = connection.name || '';
    form.targetUrl.value = connection.targetUrl || '';
    form.targetUsername.value = connection.targetUsername || '';
    form.targetPassword.value = connection.targetPassword || '';
    form.iptvUsername.value = connection.iptvUsername || '';
    form.iptvPassword.value = connection.iptvPassword || '';
    
    if (connection.expireDate) {
        form.expireDate.value = connection.expireDate;
        flatpickr(form.expireDate, {
            enableTime: false,
            dateFormat: "Y-m-d",
            allowInput: true,
            defaultDate: connection.expireDate
        });
    }
    
    showAddForm();
}
// Handle form submission
document.getElementById('connectionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    const id = data.id;
    delete data.id;

    // Validate required fields
    const requiredFields = ['name', 'targetUrl', 'targetUsername', 'targetPassword', 'iptvUsername', 'iptvPassword'];
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length > 0) {
        toastr.error(`Please fill in all required fields: ${missingFields.join(', ')}`);
        return;
    }

    // Clean and validate URL
    data.targetUrl = validateUrl(data.targetUrl);

    try {
        let response;
        if (id) {
            response = await fetch(`/api/connections/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            response = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        const result = await response.json();

        if (response.ok) {
            toastr.success(id ? 'Connection updated successfully' : 'Connection added successfully');
            hideAddForm();
            await loadConnections(); // Reload the connections list
        } else {
            toastr.error(result.error || 'Failed to save connection');
        }
    } catch (error) {
        toastr.error('Failed to save connection');
    }
});

// Function to delete connection
async function deleteConnection(id) {
    if (!confirm('Are you sure you want to delete this connection?')) return;
    
    try {
        const response = await fetch(`/api/connections/${id}`, { 
            method: 'DELETE'
        });
        
        if (response.ok) {
            toastr.success('Connection deleted successfully');
            await loadConnections(); // Reload the list after deletion
        } else {
            const error = await response.json();
            toastr.error(error.error || 'Failed to delete connection');
        }
    } catch (error) {
        toastr.error('Failed to delete connection');
    }
}

// Function to handle logout
async function logout() {
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (response.ok) {
            localStorage.removeItem('connections');
            window.location.href = '/hideme/index.html';
        } else {
            toastr.error('Failed to logout');
        }
    } catch (error) {
        toastr.error('Failed to logout');
    }
}

// Utility function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Validate URL format
function validateUrl(url) {
    if (!url) return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'http://' + url;
    }
    return url;
}

// Function to copy text to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        toastr.success('Copied to clipboard');
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            toastr.success('Copied to clipboard');
        } catch (err) {
            toastr.error('Failed to copy');
        }
        document.body.removeChild(textarea);
    });
}

// Initialize copy buttons if needed
function initializeCopyButtons() {
    document.querySelectorAll('[data-copy]').forEach(element => {
        const value = element.getAttribute('data-copy');
        const button = document.createElement('button');
        button.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z">
            </path>
        </svg>`;
        button.className = 'ml-2 text-gray-500 hover:text-gray-700';
        button.onclick = () => copyToClipboard(value);
        element.appendChild(button);
    });
}
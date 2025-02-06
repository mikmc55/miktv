// public/js/admin.js

document.getElementById('adminForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Reset messages
    const errorMsg = document.getElementById('errorMessage');
    const successMsg = document.getElementById('successMessage');
    errorMsg.classList.add('hidden');
    successMsg.classList.add('hidden');
    
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData);
    
    try {
        const response = await fetch('/api/admin/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            successMsg.textContent = 'Credentials updated successfully. Redirecting to login...';
            successMsg.classList.remove('hidden');
            
            // Clear the form
            e.target.reset();
            
            // Redirect to login after a short delay
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 2000);
        } else {
            const error = await response.json();
            errorMsg.textContent = error.error || 'Failed to update credentials';
            errorMsg.classList.remove('hidden');
        }
    } catch (error) {
        errorMsg.textContent = 'An error occurred. Please try again.';
        errorMsg.classList.remove('hidden');
    }
});


// =====================================
// TIMETRACK - COMPLETE JAVASCRIPT
// =====================================


// =====================================
// COMMON TIME FUNCTIONS
// =====================================

function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return (
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(secs).padStart(2, "0")
    );
}

function formatHoursMinutes(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return hours + "h " + minutes + "m";
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
    }

    return data;
}


// =====================================
// TIMER VARIABLES
// =====================================

let totalSeconds = 0;
let sessionSeconds = 0;
let timerInterval = null;
let isRunning = false;


// =====================================
// TIMER DISPLAY
// =====================================

function updateTimerDisplay() {
    const sessionDisplay = document.getElementById("sessionTimer");
    const totalDisplay = document.getElementById("totalTimer");

    if (sessionDisplay) {
        sessionDisplay.textContent = formatTime(sessionSeconds);
    }

    if (totalDisplay) {
        totalDisplay.textContent = formatTime(totalSeconds);
    }
}


// =====================================
// LOAD TIMER
// =====================================

async function loadTimer() {
    try {
        const data = await apiRequest("/api/timer");

        totalSeconds = Number(data.total_seconds) || 0;

        updateTimerDisplay();
    } catch (error) {
        console.error("Timer loading error:", error);
    }
}


// =====================================
// SAVE TIMER
// =====================================

async function saveTimer() {
    try {
        await apiRequest("/api/timer", {
            method: "POST",
            body: JSON.stringify({
                total_seconds: totalSeconds
            })
        });
    } catch (error) {
        console.error("Timer saving error:", error);
    }
}


// =====================================
// START TIMER
// =====================================

async function startTimer() {
    if (isRunning) return;

    try {
        await apiRequest("/api/sessions/start", {
            method: "POST",
            body: JSON.stringify({})
        });

        sessionSeconds = 0;
        isRunning = true;

        const startButton = document.getElementById("startTimer");
        const stopButton = document.getElementById("stopTimer");

        if (startButton) startButton.disabled = true;
        if (stopButton) stopButton.disabled = false;

        updateTimerDisplay();

        timerInterval = setInterval(() => {
            sessionSeconds++;
            totalSeconds++;

            updateTimerDisplay();

            if (totalSeconds % 15 === 0) {
                saveTimer();
            }
        }, 1000);

    } catch (error) {
        alert(error.message);
    }
}


// =====================================
// STOP TIMER
// =====================================

async function stopTimer() {
    if (!isRunning) return;

    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;

    const startButton = document.getElementById("startTimer");
    const stopButton = document.getElementById("stopTimer");

    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;

    try {
        const data = await apiRequest("/api/sessions/stop", {
            method: "POST",
            body: JSON.stringify({})
        });

        await saveTimer();
        await loadDailyTime();
        await loadBacklog();
        await loadWeeklyChart();

        updateTimerDisplay();

        alert(
            "Session completed!\nStudy time: " +
            formatHoursMinutes(data.duration_seconds)
        );

    } catch (error) {
        alert(error.message);
        await loadTimer();
    }
}


// =====================================
// TASK MANAGEMENT
// =====================================

async function loadTasks() {
    try {
        const tasks = await apiRequest("/api/tasks");

        const taskList = document.getElementById("taskList");

        if (!taskList) return;

        taskList.innerHTML = "";

        tasks.forEach(task => displayTask(task));

        updateProductivity();

    } catch (error) {
        console.error("Task loading error:", error);
    }
}


// =====================================
// ADD TASK
// =====================================

async function addTask() {
    const input = document.getElementById("taskInput");

    if (!input) return;

    const taskText = input.value.trim();

    if (!taskText) {
        alert("Please enter a task.");
        return;
    }

    try {
        const task = await apiRequest("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
                task_text: taskText
            })
        });

        displayTask(task);

        input.value = "";

        updateProductivity();

    } catch (error) {
        alert(error.message);
    }
}


// =====================================
// DISPLAY TASK
// =====================================

function displayTask(task) {
    const taskList = document.getElementById("taskList");

    if (!taskList) return;

    const taskItem = document.createElement("div");
    taskItem.className = "task-item";
    taskItem.dataset.id = task.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Number(task.completed) === 1;

    const taskText = document.createElement("span");
    taskText.className = "task-text";
    taskText.textContent = task.task_text;

    if (checkbox.checked) {
        taskText.classList.add("completed");
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-task";
    deleteButton.textContent = "×";
    deleteButton.type = "button";
    deleteButton.title = "Delete task";

    checkbox.addEventListener("change", async () => {
        try {
            await apiRequest(`/api/tasks/${task.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    completed: checkbox.checked
                })
            });

            taskText.classList.toggle("completed", checkbox.checked);

            updateProductivity();

        } catch (error) {
            checkbox.checked = !checkbox.checked;
            alert(error.message);
        }
    });

    deleteButton.addEventListener("click", async () => {
        try {
            await apiRequest(`/api/tasks/${task.id}`, {
                method: "DELETE"
            });

            taskItem.remove();

            updateProductivity();

        } catch (error) {
            alert(error.message);
        }
    });

    taskItem.appendChild(checkbox);
    taskItem.appendChild(taskText);
    taskItem.appendChild(deleteButton);

    taskList.appendChild(taskItem);
}


// =====================================
// PRODUCTIVITY
// =====================================

function updateProductivity() {
    const tasks = Array.from(
        document.querySelectorAll("#taskList .task-item")
    );

    const total = tasks.length;

    const completed = tasks.filter(task => {
        return task.querySelector("input").checked;
    }).length;

    const percentage = total === 0
        ? 0
        : Math.round((completed / total) * 100);

    const completedCount = document.getElementById("completedCount");
    const productivityCount = document.getElementById("productivityCount");

    if (completedCount) {
        completedCount.textContent = completed + "/" + total;
    }

    if (productivityCount) {
        productivityCount.textContent = percentage + "%";
    }

    renderTaskChart();
}


// =====================================
// DAILY PLAN
// =====================================

async function loadPlan() {
    try {
        const data = await apiRequest("/api/plan");

        const input = document.getElementById("plannedHours");

        const plannedSeconds = Number(data.planned_seconds) || 0;

        if (input) {
            input.value = plannedSeconds > 0
                ? plannedSeconds / 3600
                : "";
        }

        const plannedDisplay = document.getElementById("performancePlanned");
        const plannedTime = document.getElementById("plannedTime");
        const planMessage = document.getElementById("planMessage");

        if (plannedDisplay) {
            plannedDisplay.textContent = formatHoursMinutes(plannedSeconds);
        }

        if (plannedTime) {
            plannedTime.textContent = formatHoursMinutes(plannedSeconds);
        }

        if (planMessage) {
            planMessage.textContent = plannedSeconds > 0
                ? "Your study target is saved."
                : "No plan saved yet.";
        }

        await loadDailyTime();

    } catch (error) {
        console.error("Plan loading error:", error);
    }
}


// =====================================
// SAVE PLAN
// =====================================

async function savePlan() {
    const input = document.getElementById("plannedHours");

    if (!input) return;

    const plannedHours = Number(input.value);

    if (
        input.value.trim() === "" ||
        !Number.isFinite(plannedHours) ||
        plannedHours < 0 ||
        plannedHours > 24
    ) {
        alert("Enter a valid study target between 0 and 24 hours.");
        return;
    }

    try {
        const data = await apiRequest("/api/plan", {
            method: "POST",
            body: JSON.stringify({
                planned_hours: plannedHours
            })
        });

        const plannedSeconds = Number(data.planned_hours) * 3600;

        const plannedDisplay = document.getElementById("performancePlanned");
        const plannedTime = document.getElementById("plannedTime");
        const planMessage = document.getElementById("planMessage");

        if (plannedDisplay) {
            plannedDisplay.textContent = formatHoursMinutes(plannedSeconds);
        }

        if (plannedTime) {
            plannedTime.textContent = formatHoursMinutes(plannedSeconds);
        }

        if (planMessage) {
            planMessage.textContent = "Your study target is saved.";
        }

        await loadDailyTime();
        await loadWeeklyChart();

        alert("Daily study plan saved!");

    } catch (error) {
        alert(error.message);
    }
}


// =====================================
// DAILY PERFORMANCE
// =====================================

async function loadDailyTime() {
    try {
        const data = await apiRequest("/api/daily-time");

        const actualSeconds = Number(data.actual_seconds) || 0;

        const plannedText =
            document.getElementById("performancePlanned")?.textContent || "0h 0m";

        const plannedParts = plannedText.match(/\d+/g) || [0, 0];

        const plannedSeconds =
            Number(plannedParts[0]) * 3600 +
            Number(plannedParts[1]) * 60;

        const remainingSeconds = Math.max(
            0,
            plannedSeconds - actualSeconds
        );

        const actualDisplay = document.getElementById("actualTime");
        const remainingDisplay = document.getElementById("remainingTime");

        if (actualDisplay) {
            actualDisplay.textContent = formatHoursMinutes(actualSeconds);
        }

        if (remainingDisplay) {
            remainingDisplay.textContent = formatHoursMinutes(remainingSeconds);
        }

        displaySessionHistory(data.sessions || []);

        renderPlanActualChart();

    } catch (error) {
        console.error("Daily performance error:", error);
    }
}


// =====================================
// SESSION HISTORY
// =====================================

function displaySessionHistory(sessions) {
    const container = document.getElementById("sessionHistory");

    if (!container) return;

    container.innerHTML = "";

    if (sessions.length === 0) {
        container.textContent = "No study sessions yet today.";
        return;
    }

    sessions.forEach(session => {
        const item = document.createElement("div");
        item.className = "session-item";

        const start = new Date(session.start_time).toLocaleTimeString(
            [],
            { hour: "2-digit", minute: "2-digit" }
        );

        const end = session.end_time
            ? new Date(session.end_time).toLocaleTimeString(
                [],
                { hour: "2-digit", minute: "2-digit" }
            )
            : "In progress";

        item.textContent =
            `${start} – ${end} | ${formatHoursMinutes(session.duration_seconds)}`;

        container.appendChild(item);
    });
}


// =====================================
// BACKLOG
// =====================================

async function loadBacklog() {
    try {
        const data = await apiRequest("/api/backlog");

        const totalDisplay = document.getElementById("backlogTotal");
        const list = document.getElementById("backlogList");

        if (totalDisplay) {
            totalDisplay.textContent = formatHoursMinutes(data.active_seconds);
        }

        if (!list) return;

        list.innerHTML = "";

        if (!data.items || data.items.length === 0) {
            list.textContent = "No backlog. Great work!";
            return;
        }

        data.items.forEach(item => {
            const element = document.createElement("div");
            element.className = "backlog-item";

            const title = document.createElement("strong");
            title.textContent = item.plan_date;

            const time = document.createElement("span");
            time.textContent = formatHoursMinutes(item.remaining_seconds);

            const status = document.createElement("span");
            status.textContent = item.status;

            const deadline = document.createElement("small");
            deadline.textContent = "Deadline: " + item.deadline;

            element.appendChild(title);
            element.appendChild(time);
            element.appendChild(status);
            element.appendChild(deadline);

            list.appendChild(element);
        });

    } catch (error) {
        console.error("Backlog loading error:", error);
    }
}


// =====================================
// WEEKLY STUDY GRAPH
// =====================================

async function loadWeeklyChart() {
    const chart = document.getElementById("weeklyChart");

    if (!chart) return;

    try {
        const data = await apiRequest("/api/weekly-time");
        const days = data.days || [];

        const maxSeconds = Math.max(
            3600,
            ...days.map(day => Number(day.study_seconds) || 0)
        );

        chart.innerHTML = "";

        days.forEach(day => {
            const seconds = Number(day.study_seconds) || 0;
            const hours = seconds / 3600;
            const height = (seconds / maxSeconds) * 100;

            const column = document.createElement("div");
            column.className = "weekly-column";

            const value = document.createElement("span");
            value.className = "weekly-value";
            value.textContent = hours.toFixed(1) + "h";

            const area = document.createElement("div");
            area.className = "bar-area";

            const bar = document.createElement("div");
            bar.className = "weekly-bar";
            bar.style.height = Math.max(height, 2) + "%";
            bar.title = formatHoursMinutes(seconds);

            const label = document.createElement("span");
            label.className = "weekly-day";
            label.textContent = day.label;

            area.appendChild(bar);
            column.appendChild(value);
            column.appendChild(area);
            column.appendChild(label);

            chart.appendChild(column);
        });

    } catch (error) {
        console.error("Weekly graph error:", error);
        chart.textContent = "Could not load weekly graph.";
    }
}


// =====================================
// TASK COMPLETION GRAPH
// =====================================

function renderTaskChart() {
    const chart = document.getElementById("taskChart");

    if (!chart) return;

    const tasks = Array.from(
        document.querySelectorAll("#taskList .task-item")
    );

    const total = tasks.length;

    const completed = tasks.filter(task => {
        return task.querySelector("input").checked;
    }).length;

    const pending = total - completed;

    const percentage = total === 0
        ? 0
        : Math.round((completed / total) * 100);

    chart.innerHTML = `
        <div class="task-chart-number">
            ${percentage}%
            <span>completed</span>
        </div>

        <div class="progress-track">
            <div class="progress-fill"
                style="width: ${percentage}%">
            </div>
        </div>

        <div class="chart-legend">
            <span>
                <span class="legend-dot blue-dot"></span>
                Completed: ${completed}
            </span>

            <span>
                <span class="legend-dot pink-dot"></span>
                Pending: ${pending}
            </span>
        </div>

        <p style="color: var(--muted); font-size: 12px;">
            Total tasks: ${total}
        </p>
    `;
}


// =====================================
// PLANNED VS ACTUAL GRAPH
// =====================================

function renderPlanActualChart() {
    const chart = document.getElementById("planActualChart");

    if (!chart) return;

    const plannedText =
        document.getElementById("performancePlanned")?.textContent || "0h 0m";

    const plannedParts = plannedText.match(/\d+/g) || [0, 0];

    const plannedSeconds =
        Number(plannedParts[0]) * 3600 +
        Number(plannedParts[1]) * 60;

    const actualText =
        document.getElementById("actualTime")?.textContent || "0h 0m";

    const actualParts = actualText.match(/\d+/g) || [0, 0];

    const actualSeconds =
        Number(actualParts[0]) * 3600 +
        Number(actualParts[1]) * 60;

    const maximum = Math.max(
        plannedSeconds,
        actualSeconds,
        3600
    );

    const plannedWidth = (plannedSeconds / maximum) * 100;
    const actualWidth = (actualSeconds / maximum) * 100;

    chart.innerHTML = `
        <div class="comparison-row">

            <span class="comparison-label">Planned</span>

            <div class="comparison-track">
                <div class="comparison-fill planned-fill"
                    style="width: ${plannedWidth}%">
                </div>
            </div>

            <span class="comparison-value">
                ${formatHoursMinutes(plannedSeconds)}
            </span>

        </div>

        <div class="comparison-row">

            <span class="comparison-label">Actual</span>

            <div class="comparison-track">
                <div class="comparison-fill actual-fill"
                    style="width: ${actualWidth}%">
                </div>
            </div>

            <span class="comparison-value">
                ${formatHoursMinutes(actualSeconds)}
            </span>

        </div>
    `;
}


// =====================================
// CONNECT ALL BUTTONS
// =====================================

function connectButtons() {
    const startButton = document.getElementById("startTimer");
    const stopButton = document.getElementById("stopTimer");

    const addTaskButton = document.getElementById("addTaskBtn");
    const savePlanButton = document.getElementById("savePlanBtn");

    if (startButton) {
        startButton.addEventListener("click", startTimer);
    }

    if (stopButton) {
        stopButton.addEventListener("click", stopTimer);
        stopButton.disabled = true;
    }

    if (addTaskButton) {
        addTaskButton.addEventListener("click", addTask);
    }

    if (savePlanButton) {
        savePlanButton.addEventListener("click", savePlan);
    }

    const taskInput = document.getElementById("taskInput");

    if (taskInput) {
        taskInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                addTask();
            }
        });
    }
}


// =====================================
// INITIALIZE APPLICATION
// =====================================

async function initializeTimeTrack() {
    connectButtons();

    await Promise.all([
        loadTimer(),
        loadTasks(),
        loadPlan(),
        loadBacklog(),
        loadWeeklyChart()
    ]);

    renderTaskChart();
    renderPlanActualChart();
}


// =====================================
// START APPLICATION
// =====================================

document.addEventListener("DOMContentLoaded", initializeTimeTrack);

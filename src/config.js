/**
 * Contest Configuration
 */
let SE_bruh, SE_oiiai, SE_first, solved_problem = []; 
async function loadSound() {
    SE_bruh = await new Audio("assets/sound/bruh.mp3");
    SE_oiiai = await new Audio("assets/sound/oiiai.mp3");
    SE_first = await new Audio("assets/sound/first_blood.mp3");
    SE_pop = await new Audio("assets/sound/pop.mp3");
}

// random id to prevent cache
async function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

loadSound();
makeid(10);

config =
{
    // environment: 'production' or 'develop'
    environment : 'develop',

    // auth token: jwt token for pdogs.ntu.im

    /**
     * The following paths should be accessible:
     *    ${apiBase}/runs.json
     *    ${apiBase}/contest.json
     */
    /** example config for pdogs.ntu.im in PDAO 2026: */
    apiBase : "http://localhost:3002/pdao_be/api/runs",
    contestData : "http://localhost:3002/pdao_be/api/contest_data",
    optScoresApiUrl : "http://localhost:3002/pdao_be/api/opt_scores",
    optProblemViewIds : {
        CC: 64,
        ML: 65,
    },
    // 最佳化題目公式參數: weight = 該題配分(x), baseline = 基本解法分數(B)
    // 公式: score = weight * ((Si - baseline) / (Sbest - baseline))^1.5
    // 若 Si <= baseline，得分為 0
    optProblemFormula : {
        CC: { weight: 50, baseline: 0 },
        ML: { weight: 50, baseline: 0 },
    },
    // 最佳化分數自動刷新間隔 (毫秒)，預設 60 秒
    opt_refresh_interval : 60000,
    // 最佳化分數凍結視窗（分鐘）：比賽最後 N 分鐘不更新，結束後 10 秒才更新一次
    // 比賽 325 分鐘，凍結 290~325 → 最後 35 分鐘
    opt_freeze_window_minute : 40,
    /*
    apiBase : "./PDAO2025_result.json",
    contestData : "./PDAO2025_contestData.json",
    */
    /**
     * Specify whether to use automatically diff and feed updated runs.
     *
     * If set to false, updated runs are fetched from ${apiBase}/changed_runs.json;
     * If set to true,  fetch all runs from ${apiBase}/runs.json instead and
     *  only the updated runs would be inserted into the feed queue.
     */
    auto_rundiff       : true,

    /**
     * Specify timeout (in milliseconds) for ajax request.
     */
    fetch_timeout      : 5000,

    /**
     * Specify whether to show team group (affiliation) just below team name.
     */
    show_team_group    : true,

    /**
     * Specify whether to highlight first solve runs.
     */
    show_first_solve   : true,

    /**
     * Specify whether to show balloon images.
     */
    show_balloons   : true,

    /*
        Sound effects should be muted on initialization
    */
    sound_effects : false,
    gif_effects : true,
    /**
     * Specify whether to automatically start the scoreboard update.
     * If false, update will be paused.
     */
    auto_play          : true,

    /** Specify whether to show the event dashboard in the right-side. */
    show_events        : false,

    /** Specify the maximum number of recent events displayed in the dashboard. */
    max_notifications  : 100,

    /**
     * Specify whether to use (flip) animation on updating team's run.
     * If animation is disabled, scoreboard will be updated with silence.
     *
     * This option is ignored (always set true) in the award mode.
     */
    animation          : true,

    /** The delay time (in milliseconds) to between two consecutive run feeding. */
    auto_play_delay    : 100,

    /**
     * The interval time (in milliseconds) of fetching run updates
     * (where instant-feeding with WebSocket is not used)
     */
    auto_refresh_interval : 10000,


    /** Specify whether to use pagination, or the number of teams per page. */
    pagination      : false,
    pagination_size : 50,

    /** If true, the followed team will be sticked before it goes out of the screen. */
    use_followed_team_sticky : true,

    /**
     * Specify the teams to exclude from the scoreboard, as a function or a list of team id.
     *
     * e.g. function(team) { ... }
     */
    // this is the list of teams to be excluded from the scoreboard in PDAO 2025
    exclude_teams : [2563,2564,2565,2566,2567,2568,2569,2570,2571,2572,2573,2574,2575,2576,2577,2578,2579,2580,2581,2583,2584,2585,2586,2587,2588,2589,2590,2591],

    /**
     * Specify additional foreign or extra teams, as a function or a list of team id.
     *
     * In award ceremony, revealing of foreign teams will be postponed until
     * all the other domestic teams are revealed.
     *
     * e.g. function(team) { ... }
     * e.g. [2000, 2001]
     */
    //foreign_teams : [ 2000, 2001 ],
    foreign_teams : function(team) {
        /* an example config */
        var foreign_teams_list = [];
        var foreign_affiliations = [];

        var teamId = team.getId(),
            affiliation = team.getGroup();
        if (foreign_teams_list.indexOf(teamId) >= 0) return true;
        if (foreign_affiliations.indexOf(affiliation) >= 0) return true;
        return false;
    },

    /**
     * Specify whether to launch award mode at startup.
     * NOTE: While this option is off, one can enter to award mode by adding '?award=true' into URL.
     */
    award_mode         : false,

    /** Specify whether to hide the name and affiliation for unrevealed team in award mode. */
    award_hide_name    : true,

    /**
     * For the purpose of simulating award ceremony with ease,
     * one can start the award mode from the rank number specified to begin with.
     * If unspecified (null or undefined), the award mode will start from the bottommost team.
     *
     * NOTE: This setting can be also configured by adding '?award_rank_begin=1' into URL.
     */
    award_rank_begin   : null,

    /**
     * Override the speed of flip and elevation animations in the award mode,
     * according to the number of problems solved.
     */
    award_animation_speeds: [
    { solved: 10, fastFlipSpeed: 1200, slowFlipSpeed: 2000, utuSpeedFunc: function(up_cnt) { return Math.min(500 + up_cnt * 100, 2000); } },
    { solved: 9,  fastFlipSpeed: 800,  slowFlipSpeed: 1200, utuSpeedFunc: function(up_cnt) { return Math.min(500 + up_cnt * 100, 2000); } },
    { solved: 7,  fastFlipSpeed: 400,  slowFlipSpeed: 600,  utuSpeedFunc: function(up_cnt) { return Math.min(500 + up_cnt * 100, 2000); } },
    { solved: 3,  fastFlipSpeed: 200,  slowFlipSpeed: 300,  utuSpeedFunc: function(up_cnt) { return Math.min(250 + up_cnt * 50, 3000); } },
    { solved: 0,  fastFlipSpeed: 200,  slowFlipSpeed: 300,  utuSpeedFunc: function(up_cnt) { return Math.min(150 + up_cnt * 30, 1000); } }
    ],

    /**
     * Specify the order of problems revealed in the award mode.
     * Each element in the list should be the problem title (e.g. 'A', 'B') or problem id (e.g. 0, 1).
     *
     * The problems not specified in the list will follow the specified ones,
     * in the alphabetical order.
     *
     * e.g. ['C', 'A', 'F']  : Reveals in order 'C', 'A', 'F', 'B', 'D', 'E', 'G', ...
     */
    award_reveal_order : [],

    /**
     * Specify whether to use blinking effect before revealing a focused pending run.
     * This value can be a boolean (True or False),
     * or a function to specify trigger conditions dynamically.
     * In this case, function takes a single argument 'teamStatus', of type TeamStatus.
     */
    award_focus_blinking : function(teamStatus) {
    // use blinking effect only if # of problems solved is more than 7
    // or current ranking of the team is less than 10.
    var solved = teamStatus.getTotalSolved();
    var currentRank = teamStatus.getRank();
    return solved >= 7 || currentRank <= 10;
    },
};

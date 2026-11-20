export interface BlueprintSection {
  id: string;
  title: string;
  subtitle: string;
  language: string;
  code: string;
}

export const ARCHITECTURE_SECTIONS: BlueprintSection[] = [
  {
    id: 'scene-tree',
    title: '1. Architecture & Scene Tree',
    subtitle: 'Godot 4 / Unity modular hierarchy & GameState manager',
    language: 'text',
    code: `PRO TITANIC SOCCER — ENGINE SCENE ARCHITECTURE
================================================
Root (GameManager - Autoload/Singleton)
├── ProfileManager          # Persistent PlayerName, Avatar, ClubId, BackJerseyText
├── AudioController         # Procedural/SFX Bus (Whistle, Kick, Crowd, PostClang)
├── NetworkManager          # LAN Hotspot UDP Discovery + ENet / Netcode Peer
│
├── MainMenuScene (3D Showcase + UI Overlay)
│   ├── StadiumShowcaseEnv  # Floodlit turf podium, key/rim lights, FogExp2
│   ├── AvatarPreviewRig    # Left-side 3D character + floating overhead name label
│   │   └── JerseyBackMesh  # Dynamic SubViewport/CanvasTexture (invariant back text)
│   └── UI_HomeCanvas       # Right-aligned Title Lockup + [Play] [Profile] [Quit]
│
└── MatchArenaScene (3D Gameplay)
    ├── PitchGenerator      # Dynamic 3v3..6v6 & Compact/Standard/Titanic sizing
    ├── GoalPosts_Home/Away # RigidBody posts + Area3D GoalLineTrigger
    ├── StadiumStands       # MultiMesh/InstancedMesh spectators + floodlight towers
    ├── BallRigidBody       # Magnus curve, bounce restitution, rolling drag
    ├── PlayersContainer    # Spawned Team A & Team B (Outfield + Dedicated GK)
    │   ├── OutfieldPlayer  # OutfieldInputController + AI_StateMachine
    │   └── GoalkeeperRig   # GKInputController (locked to GK slot for full match)
    ├── ThirdPersonCamera   # Strict Player-Locked 3rd-Person Follow Cam + Glance/Orbit
    └── MatchHUD            # Scoreboard, Clock, Stamina, Mobile Virtual D-Pad`,
  },
  {
    id: 'lan-networking',
    title: '2. LAN Hotspot Discovery & Lobby (GDScript)',
    subtitle: 'UDP broadcast discovery (up to 6 peers) + automated coin toss',
    language: 'gdscript',
    code: `# NetworkManager.gd (Godot 4 — Local Wi-Fi Hotspot Peer-to-Peer)
extends Node

const DISCOVERY_PORT := 42420
const GAME_PORT := 42421
const MAX_PLAYERS := 6 # 1 Host + up to 5 Clients

var udp_broadcaster := PacketPeerUDP.new()
var udp_listener := PacketPeerUDP.new()
var peer := ENetMultiplayerPeer.new()

var discovered_hosts := {} # host_ip -> { host_name, match_size, field_size, players }
var lobby_players := {}    # peer_id -> { name, jersey_text, team, role, ready }
var match_settings := { "minutes": 6, "size": "5v5", "field": "standard", "home": "barcelona", "away": "realmadrid" }

func start_hosting(host_profile: Dictionary, settings: Dictionary) -> void:
\tmatch_settings = settings
\tpeer.create_server(GAME_PORT, MAX_PLAYERS - 1)
\tmultiplayer.multiplayer_peer = peer
\tlobby_players[1] = {
\t\t"name": host_profile.playerName, "jersey_text": host_profile.jerseyText,
\t\t"team": "home", "role": "outfield", "ready": false
\t}
\tudp_broadcaster.set_broadcast_enabled(true)
\tudp_broadcaster.set_dest_address("255.255.255.255", DISCOVERY_PORT)

func _process(_delta: float) -> void:
\tif multiplayer.is_server():
\t\tvar packet := JSON.stringify({
\t\t\t"host_name": lobby_players[1].name,
\t\t\t"settings": match_settings,
\t\t\t"count": lobby_players.size(), "max": MAX_PLAYERS
\t\t}).to_utf8_buffer()
\t\tudp_broadcaster.put_packet(packet)
\telif udp_listener.is_bound():
\t\twhile udp_listener.get_available_packet_count() > 0:
\t\t\tvar ip := udp_listener.get_packet_ip()
\t\t\tvar info := JSON.parse_string(udp_listener.get_packet().get_string_from_utf8())
\t\t\tif typeof(info) == TYPE_DICTIONARY:
\t\t\t\tdiscovered_hosts[ip] = info

@rpc("any_peer", "call_local", "reliable")
func rpc_select_team_and_role(team: String, role: String) -> void:
\tvar sender_id := multiplayer.get_remote_sender_id()
\tif role == "goalkeeper":
\t\tfor pid in lobby_players:
\t\t\tif pid != sender_id and lobby_players[pid].team == team and lobby_players[pid].role == "goalkeeper":
\t\t\t\treturn # Dedicated GK slot already claimed
\tlobby_players[sender_id].team = team
\tlobby_players[sender_id].role = role
\tlobby_players[sender_id].ready = false
\trpc("rpc_sync_lobby", lobby_players, match_settings)

@rpc("any_peer", "call_local", "reliable")
func rpc_toggle_ready() -> void:
\tvar sender_id := multiplayer.get_remote_sender_id()
\tlobby_players[sender_id].ready = not lobby_players[sender_id].ready
\tif lobby_players.values().all(func(p): return p.ready):
\t\tvar kickoff_team := "home" if randf() < 0.5 else "away" # Automated Coin Toss
\t\trpc("rpc_begin_countdown_and_kickoff", kickoff_team)`,
  },
  {
    id: 'outfield-controls',
    title: '3. Outfield Player Input Script (GDScript / C#)',
    subtitle: 'Arrow Keys / D-Pad, Left Shift Sprint, S Pass, W Through, A Loft/Tackle, D Shoot',
    language: 'gdscript',
    code: `# OutfieldController.gd (Godot 4)
extends CharacterBody3D

@export var walk_speed := 8.4
@export var sprint_speed := 12.6
var stamina := 100.0
var has_ball := false
var tackle_timer := 0.0

func _physics_process(delta: float) -> void:
\tif not is_multiplayer_authority(): return
\tif tackle_timer > 0.0:
\t\ttackle_timer -= delta
\t\tmove_and_slide()
\t\treturn

\t# Movement: Arrow Keys / Mobile Virtual D-Pad
\tvar input_dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
\tvar is_sprinting := Input.is_key_pressed(KEY_SHIFT) and input_dir.length() > 0.1 and stamina > 4.0
\tstamina = clamp(stamina + (-24.0 if is_sprinting else 16.0) * delta, 0.0, 100.0)

\tvar target_vel := Vector3(input_dir.x, 0.0, input_dir.y) * (sprint_speed if is_sprinting else walk_speed)
\tvelocity.x = lerpf(velocity.x, target_vel.x, 1.0 - exp(-12.0 * delta))
\tvelocity.z = lerpf(velocity.z, target_vel.z, 1.0 - exp(-12.0 * delta))
\tmove_and_slide()

\t# Action Bindings (S: Grounded Pass, W: Through Pass, A: Lofted Pass / Tackle, D: Shoot)
\tif Input.is_action_just_pressed("action_shoot") and has_ball:        # D Key
\t\ttrigger_shot(input_dir)
\telif Input.is_action_just_pressed("action_pass_ground") and has_ball: # S Key
\t\texecute_assisted_pass(input_dir, "grounded")
\telif Input.is_action_just_pressed("action_pass_through") and has_ball: # W Key
\t\texecute_assisted_pass(input_dir, "through")
\telif Input.is_action_just_pressed("action_loft_tackle"):            # A Key
\t\tif has_ball:
\t\t\texecute_assisted_pass(input_dir, "lofted")
\t\telse:
\t\t\tperform_slide_tackle()

func execute_assisted_pass(aim_dir: Vector2, kind: String) -> void:
\tvar fwd := Vector3(aim_dir.x, 0, aim_dir.y).normalized() if aim_dir.length() > 0.1 else -global_transform.basis.z
\tvar cone_cos := cos(deg_to_rad(45.0))
\tvar target_pos := global_position + fwd * 16.0
\tvar best_score := -INF
\tfor mate in get_tree().get_nodes_in_group("team_" + team_id):
\t\tif mate == self: continue
\t\tvar to_mate: Vector3 = mate.global_position - global_position
\t\tvar dist := to_mate.length()
\t\tif dist < 1.2 or dist > 56.0: continue
\t\tvar align := (to_mate / dist).dot(fwd)
\t\tif align >= cone_cos and (align * 3.0 - dist * 0.015) > best_score:
\t\t\tbest_score = align * 3.0 - dist * 0.015
\t\t\tif kind == "through":
\t\t\t\tvar lead := clampf(2.2 + mate.velocity.length() * 0.1, 2.0, 3.2)
\t\t\t\ttarget_pos = mate.global_position + mate.velocity.normalized() * lead
\t\t\telse:
\t\t\t\ttarget_pos = mate.global_position + mate.velocity * 0.14
\tvar delta := target_pos - ball.global_position
\tvar d := maxf(0.8, delta.length())
\tvar momentum := maxf(0.0, velocity.dot(delta / d) * 0.42)
\tvar spd := clampf(5.4 + 0.85 * d, 11.5, 29.0) + momentum
\tvar y_vel := clampf(7.2 + d * 0.15, 7.8, 13.2) if kind == "lofted" else (0.95 if kind == "through" else 0.22)
\tball.apply_pass_impulse((delta / d) * spd + Vector3(0, y_vel, 0))`,
  },
  {
    id: 'gk-controls',
    title: '4. Goalkeeper (GK) Input Script (C# / Unity)',
    subtitle: 'Arrow Keys Move, Spacebar Jump, Movement + Spacebar Dive (full match GK lock)',
    language: 'csharp',
    code: `// GoalkeeperController.cs (Unity — Dedicated Full-Match GK)
using UnityEngine;

public class GoalkeeperController : MonoBehaviour
{
    public float moveSpeed = 7.4f;
    public float jumpForce = 6.6f;
    public float diveSpeed = 11.5f;
    private Rigidbody rb;
    private float diveTimer = 0f;

    void Awake() => rb = GetComponent<Rigidbody>();

    void Update()
    {
        if (diveTimer > 0f) { diveTimer -= Time.deltaTime; return; }

        // Movement: Arrow Keys / Virtual D-Pad
        float h = (Input.GetKey(KeyCode.RightArrow) ? 1f : 0f) - (Input.GetKey(KeyCode.LeftArrow) ? 1f : 0f);
        float v = (Input.GetKey(KeyCode.UpArrow) ? 1f : 0f) - (Input.GetKey(KeyCode.DownArrow) ? 1f : 0f);
        Vector3 moveInput = new Vector3(h, 0f, v).normalized;

        if (Input.GetKeyDown(KeyCode.Space))
        {
            if (moveInput.sqrMagnitude > 0.05f)
            {
                // Dive: Movement Key + Spacebar (e.g. Left Arrow + Space = Left Dive)
                rb.velocity = new Vector3(moveInput.x * diveSpeed, 4.2f, moveInput.z * 8.5f);
                diveTimer = 0.48f;
                TriggerDiveAnimation(moveInput.x < 0 ? "DiveLeft" : "DiveRight");
            }
            else
            {
                // Jump: Spacebar alone
                rb.velocity = new Vector3(0f, jumpForce, 0f);
                diveTimer = 0.52f;
                TriggerDiveAnimation("JumpSave");
            }
            return;
        }

        rb.velocity = new Vector3(moveInput.x * moveSpeed, rb.velocity.y, moveInput.z * moveSpeed);
        ClampToPenaltyBox();
    }

    private void TriggerDiveAnimation(string state) { /* Animator.SetTrigger(state) */ }
    private void ClampToPenaltyBox() { /* Clamp X/Z within home penalty area */ }
}`,
  },
  {
    id: 'player-locked-camera',
    title: '5. Player-Locked 3rd-Person Camera (GDScript)',
    subtitle: 'Strict local player lock (zero ball tracking) + touch-drag orbit & Quick Glance',
    language: 'gdscript',
    code: `# PlayerLockedCamera.gd (Godot 4 — Attach strictly to Local Player instance)
extends Camera3D

@export var follow_distance := 14.2
@export var pivot_height := 1.45
var local_player: Node3D = null
var ball_ref: Node3D = null

var manual_yaw := 0.0
var manual_pitch := 0.44
var smooth_yaw := 0.0
var quick_glance_held := false

func _ready() -> void:
\t# In LAN Multiplayer, attach ONLY when this player owns multiplayer authority
\tif local_player and not local_player.is_multiplayer_authority():
\t\tqueue_free()

func _unhandled_input(event: InputEvent) -> void:
\tif event is InputEventScreenDrag:
\t\tmanual_yaw -= event.relative.x * 0.0065
\t\tmanual_pitch = clamp(manual_pitch + event.relative.y * 0.0045, 0.22, 0.86)

func _process(delta: float) -> void:
\tif not local_player: return
\tvar pivot := local_player.global_position + Vector3(0, pivot_height, 0)
\tvar target_yaw := manual_yaw
\tif quick_glance_held and ball_ref:
\t\tvar to_ball := pivot - ball_ref.global_position
\t\ttarget_yaw = atan2(to_ball.x, to_ball.z) # Rotate around player pivot only

\tsmooth_yaw = lerp_angle(smooth_yaw, target_yaw, 1.0 - exp(-11.0 * delta))
\tvar horiz := follow_distance * cos(manual_pitch)
\tvar desired := pivot + Vector3(horiz * sin(smooth_yaw), follow_distance * sin(manual_pitch), horiz * cos(smooth_yaw))
\tglobal_position = global_position.lerp(desired, 1.0 - exp(-12.0 * delta))
\tlook_at(pivot, Vector3.UP) # Strictly centered on local_player at all times`,
  },
];

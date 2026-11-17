// The A2UI basic catalog (v1.0), drawn with Buzz's shared design system. Component names,
// props and validation come from the published catalog; only the look is Buzz's.
import {
  createComponentImplementation,
  type ReactCatalogComponent,
} from "@a2ui/react";
import {
  Catalog,
  type ComponentApi,
  type ResolvedChildRef,
  sanitizeMediaUrl,
} from "@a2ui/web_core";
// Only the component APIs, functions and theme schema. `basicCatalog` itself carries the Lit
// elements, so importing it would pull lit into this chunk.
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
} from "@a2ui/web_core/catalogs/basic/v1";
import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  BellSlashIcon,
  CalendarIcon,
  CheckIcon,
  DotsThreeIcon,
  DotsThreeVerticalIcon,
  DownloadIcon,
  EnvelopeIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderSimpleIcon,
  GearIcon,
  HouseIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MenuIcon,
  PaperclipIcon,
  PauseIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlayIcon,
  PlusIcon,
  QuestionIcon,
  SendIcon,
  ShareIcon,
  StarFilledIcon,
  StopIcon,
  TrashIcon,
  UserIcon,
  VideoCameraIcon,
  WarningCircleIcon,
  XIcon,
  ArrowClockwiseIcon,
  CloudUploadIcon,
} from "../../shared/design-system/icons/index";
import { Button } from "../../shared/design-system/ui/Button";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { Radio, RadioGroup } from "../../shared/design-system/ui/RadioGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import styles from "./A2ui.module.css";

// Resolved props are typed from the catalog at runtime, so renderers read them loosely.
type Props = Record<string, unknown> & {
  setValue?: (value: unknown) => void;
  action?: () => Promise<void>;
  isValid?: boolean;
  validationErrors?: string[];
};
type Build = (id: string, basePath?: string) => ReactNode;

function api(name: string): ComponentApi {
  const entry = BASIC_COMPONENTS.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`A2UI basic catalog has no ${name}`);
  return entry;
}

function component(
  name: string,
  render: (props: Props, buildChild: Build) => ReactNode,
): ReactCatalogComponent {
  return createComponentImplementation(api(name), ({ props, buildChild }) =>
    render(props as Props, buildChild),
  );
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

function children(props: Props, buildChild: Build): ReactNode[] {
  const list = Array.isArray(props.children)
    ? (props.children as (string | ResolvedChildRef)[])
    : [];
  return list.map((child) =>
    typeof child === "string" ? (
      <div key={child}>{buildChild(child)}</div>
    ) : (
      <div key={`${child.id}@${child.basePath}`}>
        {buildChild(child.id, child.basePath)}
      </div>
    ),
  );
}

function fieldError(props: Props): string | undefined {
  if (props.isValid !== false) return undefined;
  return props.validationErrors?.[0];
}

/** Catalog icon names that have a Buzz icon. Others show their name as text. */
const ICONS: Record<string, typeof CheckIcon> = {
  accountCircle: UserIcon,
  add: PlusIcon,
  arrowBack: ArrowLeftIcon,
  arrowForward: ArrowRightIcon,
  attachFile: PaperclipIcon,
  calendarToday: CalendarIcon,
  call: PhoneIcon,
  camera: VideoCameraIcon,
  check: CheckIcon,
  close: XIcon,
  delete: TrashIcon,
  download: DownloadIcon,
  edit: PencilSimpleIcon,
  error: WarningCircleIcon,
  event: CalendarIcon,
  folder: FolderSimpleIcon,
  help: QuestionIcon,
  home: HouseIcon,
  info: InfoIcon,
  lock: LockIcon,
  mail: EnvelopeIcon,
  menu: MenuIcon,
  moreHoriz: DotsThreeIcon,
  moreVert: DotsThreeVerticalIcon,
  notifications: BellIcon,
  notificationsOff: BellSlashIcon,
  pause: PauseIcon,
  person: UserIcon,
  phone: PhoneIcon,
  photo: ImageIcon,
  play: PlayIcon,
  refresh: ArrowClockwiseIcon,
  search: MagnifyingGlassIcon,
  send: SendIcon,
  settings: GearIcon,
  share: ShareIcon,
  star: StarFilledIcon,
  stop: StopIcon,
  upload: CloudUploadIcon,
  visibility: EyeIcon,
  visibilityOff: EyeSlashIcon,
  warning: WarningCircleIcon,
};

/** In the catalog, so Express output validates, but not drawn natively yet. */
function unsupported(name: string): ReactCatalogComponent {
  return component(name, () => (
    <p
      className={`${styles.unsupported} text-body-sm`}
      data-a2ui-unsupported={name}
    >
      Unsupported: {name}
    </p>
  ));
}

const components: ReactCatalogComponent[] = [
  component("Text", (props) => (
    // A span, so a Button's label stays valid inside the button.
    <span
      className={`${styles.text} ${
        props.variant === "caption"
          ? "text-caption text-subtle"
          : "text-body-sm"
      }`}
    >
      {str(props.text)}
    </span>
  )),
  component("Image", (props) => (
    <img
      src={sanitizeMediaUrl(props.url)}
      alt={str(props.description)}
      className={styles.image}
      data-variant={str(props.variant) || undefined}
    />
  )),
  component("Icon", (props) => {
    const name = typeof props.name === "string" ? props.name : "";
    const Icon = ICONS[name];
    return Icon ? (
      <Icon size={18} aria-hidden={false} role="img" aria-label={name} />
    ) : (
      <span className="text-caption text-subtle">{name || "icon"}</span>
    );
  }),
  component("Row", (props, buildChild) => (
    <div
      className={styles.row}
      data-justify={str(props.justify) || undefined}
      data-align={str(props.align) || undefined}
    >
      {children(props, buildChild)}
    </div>
  )),
  component("Column", (props, buildChild) => (
    <div
      className={styles.stack}
      data-justify={str(props.justify) || undefined}
      data-align={str(props.align) || undefined}
    >
      {children(props, buildChild)}
    </div>
  )),
  component("List", (props, buildChild) => (
    <div
      className={styles.list}
      data-direction={str(props.direction) || undefined}
    >
      {children(props, buildChild)}
    </div>
  )),
  component("Card", (props, buildChild) => (
    <div className={styles.card}>
      {typeof props.child === "string" ? buildChild(props.child) : null}
    </div>
  )),
  component("Divider", (props) => (
    <hr
      className={styles.divider}
      data-axis={props.axis === "vertical" ? "vertical" : undefined}
    />
  )),
  component("Button", (props, buildChild) => (
    <Button
      size="sm"
      variant={
        props.variant === "primary"
          ? "primary"
          : props.variant === "borderless"
            ? "ghost"
            : "subtle"
      }
      disabled={props.isValid === false}
      onClick={() => void props.action?.()}
    >
      {typeof props.child === "string" ? buildChild(props.child) : null}
    </Button>
  )),
  component("TextField", (props) => {
    const label = str(props.label);
    const value = str(props.value);
    const onChange = (event: { target: { value: string } }) =>
      props.setValue?.(event.target.value);
    return (
      <Field
        label={label || "Text"}
        labelVisibility={label ? "visible" : "hidden"}
        error={fieldError(props)}
      >
        {props.variant === "longText" ? (
          <Textarea
            placeholder={str(props.placeholder)}
            value={value}
            onChange={onChange}
          />
        ) : (
          <Input
            controlSize="sm"
            type={
              props.variant === "obscured"
                ? "password"
                : props.variant === "number"
                  ? "number"
                  : "text"
            }
            placeholder={str(props.placeholder)}
            value={value}
            onChange={onChange}
          />
        )}
      </Field>
    );
  }),
  component("CheckBox", (props) => (
    <Checkbox
      size="sm"
      label={str(props.label)}
      checked={props.value === true}
      onCheckedChange={(checked) => props.setValue?.(checked === true)}
    />
  )),
  component("ChoicePicker", (props) => {
    const options = Array.isArray(props.options)
      ? (props.options as { label?: unknown; value?: unknown }[])
      : [];
    const selected = Array.isArray(props.value)
      ? (props.value as string[])
      : [];
    const label = str(props.label);
    return (
      <Field
        label={label || "Choose"}
        labelVisibility={label ? "visible" : "hidden"}
        nativeLabel={false}
        error={fieldError(props)}
      >
        {props.variant === "multipleSelection" ? (
          <div className={styles.list}>
            {options.map((option) => {
              const value = str(option.value);
              return (
                <Checkbox
                  key={value}
                  size="sm"
                  label={str(option.label) || value}
                  checked={selected.includes(value)}
                  onCheckedChange={(checked) =>
                    props.setValue?.(
                      checked
                        ? [...selected, value]
                        : selected.filter((item) => item !== value),
                    )
                  }
                />
              );
            })}
          </div>
        ) : (
          <RadioGroup
            size="sm"
            value={selected[0] ?? ""}
            onValueChange={(value) => props.setValue?.([String(value)])}
          >
            {options.map((option) => {
              const value = str(option.value);
              return (
                <Radio
                  key={value}
                  size="sm"
                  value={value}
                  label={str(option.label) || value}
                />
              );
            })}
          </RadioGroup>
        )}
      </Field>
    );
  }),
  unsupported("Video"),
  unsupported("AudioPlayer"),
  unsupported("Tabs"),
  unsupported("Modal"),
  unsupported("Slider"),
  unsupported("DateTimeInput"),
];

/** Same id, components and functions as the basic catalog, so Express output validates as-is. */
export const buzzBasicCatalog = new Catalog<ReactCatalogComponent>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  components,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
);
